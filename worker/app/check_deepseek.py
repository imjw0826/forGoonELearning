"""Run inside the configured worker: python -m app.check_deepseek."""
import asyncio

from . import llm


async def main() -> int:
    try:
        await llm.check_connection()
    except RuntimeError as exc:
        print(str(exc))
        return 1
    finally:
        await llm._client.aclose()
    print('DeepSeek 인증 연결 확인 성공. 모델 목록 접근을 확인했습니다(전사·생성 품질 검사는 아님).')
    return 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
