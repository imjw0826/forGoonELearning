import asyncio
from pathlib import Path
import re
import shutil
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from app import config, pdf_ocr, pipeline, supa


def make_pdf(path: Path):
    from PIL import Image, ImageDraw, ImageFont
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    font = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 64)
    image = Image.new('RGB', (1800, 2200), 'white')
    draw = ImageDraw.Draw(image)
    for n, line in enumerate(['동양의 고전', '공자는 배움과 실천을 강조하였다.', '사마천과 굴원의 사상', '孔子 學而時習之', 'LECTURE MATERIAL OCR TEST']):
        draw.text((100, 200+n*160), line, fill='black', font=font)
    pdf = canvas.Canvas(str(path), pagesize=(600, 800))
    pdf.drawString(70, 730, 'NATIVE TEXT PAGE - keep exact wording')
    pdf.showPage()
    pdf.drawImage(ImageReader(image), 0, 0, width=600, height=800)
    pdf.showPage()
    pdf.drawImage(ImageReader(image), 0, 100, width=600, height=660)
    pdf.drawString(70, 40, 'Native footer only - image above still needs OCR')
    pdf.save()


ROW = {'id':'material-1','lecture_id':'lecture-1','filename':'scan.pdf','storage_path':'lecture-1/scan.pdf','extracted_text':None}


class PdfTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_native_scanned_and_mixed_pages(self):
        for tool in ['pdfinfo','pdfimages','pdftotext','pdftoppm','tesseract']:
            self.assertIsNotNone(shutil.which(tool), f'Install {tool}')
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            make_pdf(folder/'source.pdf')
            text = await pdf_ocr.extract_pdf(folder/'source.pdf',folder)
            self.assertIn('[페이지 1]\nNATIVE TEXT PAGE - keep exact wording',text)
            self.assertIn('[페이지 2]',text)
            self.assertIn('[페이지 3]',text)
            normalized = re.sub(r'\s+','',text)
            self.assertGreaterEqual(normalized.count('동양의고전'),2)
            self.assertGreaterEqual(normalized.count('LECTUREMATERIALOCRTEST'),2)
            self.assertGreaterEqual(normalized.count('孔子'),2)
            self.assertIn('Native footer only',text)
            self.assertNotIn('[이미지 OCR]',text.split('[페이지 2]')[0])
            self.assertFalse((folder/'page.png').exists())
            self.assertFalse((folder/'ocr.txt').exists())
            print('REAL OCR: native + Korean/English scan + mixed-page footer passed')

    async def test_plain_text_pdf_skips_ocr(self):
        from reportlab.pdfgen import canvas
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp); source=folder/'source.pdf'
            pdf=canvas.Canvas(str(source));pdf.drawString(70,730,'ACCURATE NATIVE TEXT');pdf.save()
            real_run=pdf_ocr._run
            async def run(*args,**kwargs):
                self.assertNotEqual(args[0],'tesseract')
                return await real_run(*args,**kwargs)
            with patch.object(pdf_ocr,'_run',side_effect=run):
                self.assertIn('ACCURATE NATIVE TEXT',await pdf_ocr.extract_pdf(source,folder))

    async def test_cached_and_non_pdf_materials_skip_download(self):
        with patch.object(supa,'select_one',new_callable=AsyncMock) as read:
            self.assertEqual(await pdf_ocr.material_text({**ROW,'extracted_text':pdf_ocr.CACHE_PREFIX+'cached text'}),'cached text')
            self.assertEqual(await pdf_ocr.material_text({**ROW,'filename':'file.txt','extracted_text':'plain'}),'plain')
            read.assert_not_awaited()

    async def test_legacy_pdf_upgrades_once_and_prompts_receive_clean_text(self):
        old={**ROW,'extracted_text':'old native text only'}
        with patch.object(supa,'select',AsyncMock(return_value=[old])), \
             patch.object(supa,'select_one',AsyncMock(return_value=old)), \
             patch.object(pdf_ocr,'_download',new_callable=AsyncMock), \
             patch.object(pdf_ocr,'extract_pdf',AsyncMock(return_value='[페이지 2]\n이미지의 용어')), \
             patch.object(supa,'update',new_callable=AsyncMock) as update:
            text=await pipeline.materials_text('lecture-1')
        self.assertEqual(text,'【scan.pdf】\n[페이지 2]\n이미지의 용어')
        self.assertEqual(update.call_args.args[2]['extracted_text'],pdf_ocr.CACHE_PREFIX+'[페이지 2]\n이미지의 용어')

    async def test_failed_ocr_preserves_old_extraction(self):
        with patch.object(supa,'select_one',AsyncMock(return_value=ROW)), \
             patch.object(pdf_ocr,'_download',new_callable=AsyncMock), \
             patch.object(pdf_ocr,'extract_pdf',AsyncMock(side_effect=pdf_ocr.PdfExtractionError('unreadable'))), \
             patch.object(supa,'update',new_callable=AsyncMock) as update:
            with self.assertRaises(pdf_ocr.PdfExtractionError):
                await pdf_ocr.material_text(ROW)
            update.assert_not_awaited()

    async def test_download_is_bounded_and_paths_are_private(self):
        requests=[]
        def handle(req):
            requests.append(req)
            return httpx.Response(200,content=b'%PDF'+b'x'*20)
        async with httpx.AsyncClient(base_url='https://local.test',transport=httpx.MockTransport(handle)) as client:
            with tempfile.TemporaryDirectory() as temp, patch.object(supa,'client',return_value=client), patch.object(config,'MAX_PDF_BYTES',10):
                with self.assertRaises(pdf_ocr.PdfExtractionError):
                    await pdf_ocr._download(ROW,Path(temp)/'source.pdf')
                self.assertEqual(requests[0].url.path,'/storage/v1/object/authenticated/materials/lecture-1/scan.pdf')
                with self.assertRaises(pdf_ocr.PdfExtractionError):
                    await pdf_ocr._download({**ROW,'storage_path':'other/private.pdf'},Path(temp)/'other.pdf')
                self.assertEqual(len(requests),1)

    async def test_page_limit_and_command_timeout(self):
        with patch.object(pdf_ocr,'_run',AsyncMock(return_value='Pages: 201\n')):
            with self.assertRaisesRegex(pdf_ocr.PdfExtractionError,'200페이지'):
                await pdf_ocr.extract_pdf(Path('fake.pdf'),Path('.'))
        import sys
        with self.assertRaisesRegex(pdf_ocr.PdfExtractionError,'시간'):
            await pdf_ocr._run(sys.executable,'-c','import time;time.sleep(30)',timeout=0.05)

    async def test_corrupt_pdf_fails_without_saving(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp);source=folder/'bad.pdf';source.write_bytes(b'not a PDF')
            with self.assertRaises(pdf_ocr.PdfExtractionError):
                await pdf_ocr.extract_pdf(source,folder)


if __name__=='__main__':
    unittest.main()
