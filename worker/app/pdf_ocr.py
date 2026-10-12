"""PDF text and image OCR, executed lazily on the native worker before AI prompts.

No schema migration: extracted_text carries a versioned cache header, stripped
before prompt assembly. Existing PDF rows without that header are upgraded once.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import quote

from . import config, supa

CACHE_PREFIX = '[yoyaku-pdf-ocr:v1]\n'
# One PDF at a time bounds native rendering/OCR memory across concurrent jobs.
_gate = asyncio.Semaphore(1)


class PdfExtractionError(RuntimeError):
    pass


async def _run(*args: str, timeout: float = 60) -> str:
    try:
        process = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            env={**os.environ, 'OMP_THREAD_LIMIT': '1', 'LC_ALL': 'C'},
        )
    except FileNotFoundError:
        raise PdfExtractionError('PDF OCR 도구가 없습니다. 최신 worker/Dockerfile로 워커를 다시 배포해주세요.') from None
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout)
        if process.returncode:
            raise PdfExtractionError('PDF 분석에 실패했습니다. 암호·손상 여부 및 OCR 언어팩 설치를 확인해주세요.')
        return output.decode('utf-8', errors='replace')
    except TimeoutError:
        raise PdfExtractionError('PDF 페이지 분석 시간이 초과됐습니다. 자료를 나눠서 다시 올려주세요.') from None
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


def _read_text(path: Path) -> str:
    with path.open(encoding='utf-8', errors='replace') as stream:
        text = stream.read(config.MAX_MATERIAL_CHARS + 1)
    if len(text) > config.MAX_MATERIAL_CHARS:
        raise PdfExtractionError('자료 텍스트가 20만 자를 초과합니다. PDF를 나눠서 올려주세요.')
    return text.strip()


def _merge_text(native: str, ocr: str) -> str:
    # Prefer accurate native text; append image text not already present there.
    def normalized(text: str) -> str:
        return re.sub(r'\s+', '', text).casefold()
    known = normalized(native)
    added = []
    for line in ocr.splitlines():
        line = line.strip()
        key = normalized(line)
        if key and key not in known:
            added.append(line)
            known += key
    if not native:
        return '\n'.join(added)
    return native + ('\n[이미지 OCR]\n' + '\n'.join(added) if added else '')


async def extract_pdf(source: Path, folder: Path) -> str:
    info = await _run('pdfinfo', str(source), timeout=30)
    match = re.search(r'^Pages:\s+(\d+)\s*$', info, re.M)
    if not match:
        raise PdfExtractionError('PDF 페이지 수를 확인하지 못했습니다.')
    pages = int(match[1])
    if not 0 < pages <= config.MAX_PDF_PAGES:
        raise PdfExtractionError(f'PDF는 파일당 {config.MAX_PDF_PAGES}페이지까지 지원합니다. 자료를 나눠 올려주세요.')
    images = await _run('pdfimages', '-list', str(source), timeout=30)
    image_pages = {int(m[1]) for m in re.finditer(r'^\s*(\d+)\s+\d+\s+', images, re.M)}
    blocks = []
    length = 0
    any_text = False
    for page in range(1, pages + 1):
        native_file = folder / 'native.txt'
        await _run('pdftotext', '-f', str(page), '-l', str(page), '-layout', '-enc', 'UTF-8', str(source), str(native_file))
        native = _read_text(native_file)
        native_file.unlink()
        text = native
        # A text footer must not hide the scanned slide above it. OCR every image page.
        if page in image_pages or not native.strip():
            prefix = folder / 'page'
            image = folder / 'page.png'
            ocr_file = folder / 'ocr.txt'
            try:
                await _run('pdftoppm', '-f', str(page), '-l', str(page), '-singlefile', '-scale-to', '2400',
                           '-png', str(source), str(prefix))
                await _run('tesseract', str(image), str(folder / 'ocr'), '-l', config.OCR_LANGUAGES, '--psm', '6', timeout=90)
                text = _merge_text(native, _read_text(ocr_file))
            finally:
                image.unlink(missing_ok=True)
                ocr_file.unlink(missing_ok=True)
        any_text = any_text or bool(text.strip())
        block = f'[페이지 {page}]\n{text or "(인식된 텍스트 없음)"}'
        length += len(block) + 2
        if length > config.MAX_MATERIAL_CHARS:
            raise PdfExtractionError('자료 텍스트가 20만 자를 초과합니다. PDF를 나눠서 올려주세요.')
        blocks.append(block)
    if not any_text:
        raise PdfExtractionError('PDF에서 글자를 인식하지 못했습니다. 선명한 인쇄체 스캔본인지 확인해주세요.')
    return '\n\n'.join(blocks)


async def _download(row: dict, destination: Path) -> None:
    path = row['storage_path']
    if not path.startswith(f"{row['lecture_id']}/") or '..' in path.split('/'):
        raise PdfExtractionError('잘못된 강의자료 경로입니다.')
    # Use the configured private bucket; never fetch a caller-supplied URL.
    async with supa.client().stream('GET', f'/storage/v1/object/authenticated/{config.MATERIALS_BUCKET}/{quote(path)}') as response:
        if response.status_code != 200:
            raise PdfExtractionError(f'PDF 다운로드 실패 ({response.status_code}). 자료를 다시 올리거나 저장소 연결을 확인해주세요.')
        length = response.headers.get('content-length')
        if length and int(length) > config.MAX_PDF_BYTES:
            raise PdfExtractionError('PDF는 파일당 50 MiB까지 지원합니다.')
        total = 0
        with destination.open('wb') as stream:
            async for chunk in response.aiter_bytes(chunk_size=256 * 1024):
                total += len(chunk)
                if total > config.MAX_PDF_BYTES:
                    raise PdfExtractionError('PDF는 파일당 50 MiB까지 지원합니다.')
                stream.write(chunk)
        if not total:
            raise PdfExtractionError('PDF 파일이 비어 있습니다.')


async def material_text(row: dict) -> str:
    text = row.get('extracted_text') or ''
    if not row['filename'].lower().endswith('.pdf'):
        return text
    if text.startswith(CACHE_PREFIX):
        return text[len(CACHE_PREFIX):]
    async with _gate:
        # A concurrent task may already have cached this immutable uploaded file.
        current = await supa.select_one('materials', {'select': '*', 'id': f"eq.{row['id']}", 'lecture_id': f"eq.{row['lecture_id']}"})
        if not current:
            raise PdfExtractionError('처리할 PDF가 삭제되었습니다. 강의자료 목록을 확인해주세요.')
        text = current.get('extracted_text') or ''
        if text.startswith(CACHE_PREFIX):
            return text[len(CACHE_PREFIX):]
        try:
            async with asyncio.timeout(config.PDF_ANALYSIS_TIMEOUT_SEC):
                with tempfile.TemporaryDirectory(prefix='yoyaku-pdf-') as temp:
                    folder = Path(temp)
                    source = folder / 'source.pdf'
                    await _download(current, source)
                    text = await extract_pdf(source, folder)
        except TimeoutError:
            raise PdfExtractionError('PDF 분석 시간이 초과됐습니다. 자료를 나눠서 다시 시도해주세요.') from None
        # Save only complete results. Failure leaves old text intact for safe retry.
        await supa.update('materials', {'id': f"eq.{row['id']}", 'lecture_id': f"eq.{row['lecture_id']}"}, {'extracted_text': CACHE_PREFIX + text})
        return text
