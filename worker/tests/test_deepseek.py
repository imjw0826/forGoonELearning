import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from app import config, llm, pipeline


class DeepSeekTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.key_patch = patch.object(config, 'DEEPSEEK_API_KEY', 'test-key')
        self.key_patch.start()
        self.client = None
        self.client_patch = None

    async def asyncTearDown(self):
        if self.client_patch:
            self.client_patch.stop()
            await self.client.aclose()
        self.key_patch.stop()

    def transport(self, handler):
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        self.client_patch = patch.object(llm, '_client', self.client)
        self.client_patch.start()

    async def test_401_one_preflight_no_fifteen_completion_calls(self):
        requests = []
        def handle(req):
            requests.append(req)
            return httpx.Response(401, json={'error': {'message': 'secret-do-not-copy'}})
        self.transport(handle)
        work = AsyncMock()
        with self.assertRaises(llm.DeepSeekAuthenticationError) as error:
            await llm.run_batch(list(range(15)), work, 4)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].url.path, '/models')
        self.assertEqual(requests[0].headers['Authorization'], 'Bearer test-key')
        self.assertNotIn('secret-do-not-copy', str(error.exception))
        self.assertIn('Railway', str(error.exception))
        work.assert_not_awaited()

    async def test_401_during_chat_is_not_retried_or_leaked(self):
        requests = []
        def handle(req):
            requests.append(req)
            return httpx.Response(401, text='secret-do-not-copy')
        self.transport(handle)
        with self.assertRaises(llm.DeepSeekAuthenticationError) as error:
            await llm.chat([])
        self.assertEqual(len(requests), 1)
        self.assertNotIn('secret-do-not-copy', str(error.exception))

    async def test_mid_batch_revocation_stops_queued_chunks(self):
        self.transport(lambda req: httpx.Response(200, json={'data': []}))
        started = []
        async def work(n):
            started.append(n)
            await asyncio.sleep(0)
            raise llm.DeepSeekAuthenticationError('revoked')
        with self.assertRaises(llm.DeepSeekAuthenticationError):
            await llm.run_batch(list(range(15)), work, 4)
        self.assertLessEqual(len(started), 4)

    async def test_empty_batch_does_not_require_a_key(self):
        with patch.object(config, 'DEEPSEEK_API_KEY', ''):
            self.assertEqual(await llm.run_batch([], AsyncMock(), 4), [])

    async def test_valid_connection_and_temporary_retry(self):
        attempts = []
        def handle(req):
            if req.url.path.endswith('/models'):
                return httpx.Response(200, json={'data': []})
            attempts.append(req)
            if len(attempts) == 1:
                return httpx.Response(503)
            return httpx.Response(200, json={'choices': [{'message': {'content': '교정 완료'}}]})
        self.transport(handle)
        await llm.check_connection()
        with patch('app.llm.asyncio.sleep', new_callable=AsyncMock):
            self.assertEqual(await llm.chat([]), '교정 완료')
        self.assertEqual(len(attempts), 2)

    async def test_configuration_mistakes_fail_before_network(self):
        self.transport(lambda req: self.fail('must not send malformed credentials'))
        for key in ['', 'Bearer test-key', '"test-key"', 'test key']:
            with self.subTest(key=key), patch.object(config, 'DEEPSEEK_API_KEY', key):
                with self.assertRaises(llm.DeepSeekAuthenticationError):
                    await llm.check_connection()

    async def test_balance_error_is_distinct_from_bad_key(self):
        self.transport(lambda req: httpx.Response(402, text='private provider response'))
        with self.assertRaisesRegex(RuntimeError, '잔액') as error:
            await llm.chat([])
        self.assertNotIsInstance(error.exception, llm.DeepSeekAuthenticationError)
        self.assertNotIn('private provider response', str(error.exception))

    async def test_resume_preserves_completed_chunks_and_skips_whisper(self):
        lecture = {'id': 'lecture', 'extract_status': 'correcting', 'session_no': 1, 'title': '강의'}
        chunks = [{'idx': 0, 'raw_text': '원문1', 'corrected_text': '기존 교정'},
                  {'idx': 1, 'raw_text': '원문2', 'corrected_text': None}]
        def handle(req):
            if req.url.path.endswith('/models'):
                return httpx.Response(200, json={'data': []})
            return httpx.Response(200, json={'choices': [{'message': {'content': '새 교정'}}]})
        self.transport(handle)
        async def update(table, filters, values):
            if table == 'transcript_chunks':
                index = int(filters['idx'][3:])
                chunks[index].update(values)
        with patch.object(pipeline, 'get_lecture', AsyncMock(return_value=lecture)), \
             patch.object(pipeline, 'materials_text', AsyncMock(return_value='')), \
             patch.object(pipeline.supa, 'select', AsyncMock(return_value=chunks)), \
             patch.object(pipeline.supa, 'update', AsyncMock(side_effect=update)) as updates, \
             patch.object(pipeline, 'update_lecture', new_callable=AsyncMock) as save, \
             patch.object(pipeline, '_transcribe', new_callable=AsyncMock) as transcribe:
            await pipeline.run_extract('lecture')
        transcribe.assert_not_awaited()
        self.assertEqual(updates.await_count, 1)
        self.assertEqual(chunks[0]['corrected_text'], '기존 교정')
        self.assertEqual(save.call_args.args[1]['transcript'], '기존 교정\n\n새 교정')
        self.assertEqual(save.call_args.args[1]['extract_status'], 'done')


if __name__ == '__main__':
    unittest.main()
