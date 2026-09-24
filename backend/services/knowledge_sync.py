"""질의에 필요한 법령·판례를 벡터 DB에 한 번만 수집한다.

이전 구현의 문제:
- 수집 여부를 documents 앞쪽 1000행으로 만든 메모리 캐시로 판단해, 그 밖에 있는 법령은
  매 질의마다 삭제 후 전체 재임베딩됐다.
- 판례는 metadata.prec_id로 저장하면서 metadata.mst로 존재를 확인해 한 번도 일치하지 않았고,
  같은 판례가 질의마다 다시 임베딩·중복 저장됐다.
여기서는 DB를 직접 조회해 없는 문서만 추가하고, 삭제 후 재삽입은 하지 않는다.
"""
import asyncio
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

MAX_PRECEDENTS_PER_QUERY = 3

# 같은 인스턴스에서 동시에 들어온 요청이 같은 문서를 중복 수집하지 않게 한다.
_in_flight: set = set()


def _as_list(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, dict):
        return [value]
    return list(value or [])


class KnowledgeSync:
    def __init__(self, rag_engine, law_client, document_processor):
        self.rag = rag_engine
        self.law_client = law_client
        self.processor = document_processor

    async def _exists(self, field: str, value: str, doc_type: Optional[str] = None) -> bool:
        return await asyncio.to_thread(self.rag.has_document, field, value, doc_type)

    async def _add_once(self, key: str, loader) -> int:
        if key in _in_flight:
            return 0
        _in_flight.add(key)
        try:
            docs = await loader()
            return await self.rag.add_documents(docs) if docs else 0
        finally:
            _in_flight.discard(key)

    async def sync_law(self, law_name: str) -> int:
        """법령 하나를 필요할 때만 수집하고, 새로 추가한 청크 수를 돌려준다."""
        if await self._exists("source", law_name, "law"):
            return 0
        search = await self.law_client.search_laws(law_name)
        candidates = _as_list(search.get("law"))
        if not candidates:
            return 0
        best = next((item for item in candidates if item.get("법령명한글") == law_name), candidates[0])
        mst = str(best.get("법령일련번호") or "")
        # 약칭·띄어쓰기 차이로 이름이 달라도 같은 법령(MST)이 이미 있으면 다시 받지 않는다.
        if not mst or await self._exists("mst", mst, "law"):
            return 0

        async def load():
            detail = await self.law_client.get_law_detail(mst)
            return self.processor.process_law_xml(detail, mst) if detail else []

        return await self._add_once(f"law:{mst}", load)

    async def sync_required_laws(self, query: str) -> int:
        law_names = await self.rag.detect_required_laws(query)
        added = 0
        for law_name in law_names:
            try:
                added += await self.sync_law(law_name)
            except Exception as exc:
                logger.warning("law sync failed law=%s error=%s", law_name, exc)
        return added

    async def sync_related_precedents(self, query: str) -> int:
        try:
            search = await self.law_client.search_precedents(query)
        except Exception as exc:
            logger.warning("precedent search failed error=%s", exc)
            return 0
        added = 0
        for item in _as_list(search.get("prec"))[:MAX_PRECEDENTS_PER_QUERY]:
            prec_id = str(item.get("판례일련번호") or "")
            if not prec_id:
                continue
            try:
                if await self._exists("prec_id", prec_id, "precedent"):
                    continue

                async def load(prec_id=prec_id):
                    detail = await self.law_client.get_precedent_detail(prec_id)
                    return self.processor.process_precedent_xml(detail, prec_id) if detail else []

                added += await self._add_once(f"precedent:{prec_id}", load)
            except Exception as exc:
                logger.warning("precedent sync failed prec_id=%s error=%s", prec_id, exc)
        return added
