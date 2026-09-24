"""질의 임베딩으로 참고 문서를 검색한다.

기존 match_documents RPC는 전체 문서에서 상위 N개를 가져온 뒤 파이썬에서 다른 사용자의
업로드를 걸러냈다. 같은 분야의 남의 자료가 상위권을 차지하면 걸러낸 뒤 남는 법령·판례가
줄어들었으므로, 사용자 범위 조건을 DB 검색 단계에 넣는다. 실패하면 기존 RPC로 돌아간다.
"""
import logging
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import text

logger = logging.getLogger(__name__)

SCOPED_SEARCH_SQL = text("""
    SELECT content, metadata, 1 - (embedding <=> CAST(:query_embedding AS vector)) AS similarity
    FROM documents
    WHERE 1 - (embedding <=> CAST(:query_embedding AS vector)) > :match_threshold
      AND (
        COALESCE(metadata->>'type', '') <> 'user_upload'
        OR (
          metadata->>'user_id' = :user_id
          AND (
            metadata->>'upload_id' = ANY(CAST(:active_upload_ids AS text[]))
            OR (
              metadata->>'upload_id' IS NULL
              AND NOT (COALESCE(metadata->>'source', '') = ANY(CAST(:inactive_legacy_sources AS text[])))
            )
          )
        )
      )
    ORDER BY embedding <=> CAST(:query_embedding AS vector)
    LIMIT :match_count
""")


def vector_literal(embedding: Iterable[float]) -> str:
    return "[" + ",".join(repr(float(value)) for value in embedding) + "]"


def is_visible(metadata: Dict[str, Any], user_id: Any, active_upload_ids: Set[str], inactive_legacy_sources: Set[str]) -> bool:
    """법령·판례는 모두에게, 업로드 자료는 본인의 활성 버전만 보인다."""
    if metadata.get("type") != "user_upload":
        return True
    if str(metadata.get("user_id")) != str(user_id):
        return False
    upload_id = metadata.get("upload_id")
    if upload_id:
        return str(upload_id) in active_upload_ids
    return metadata.get("source") not in inactive_legacy_sources


def search_documents(
    db,
    rag_engine,
    embedding: List[float],
    *,
    user_id: Any,
    active_upload_ids: Set[str],
    inactive_legacy_sources: Set[str],
    match_threshold: float = 0.3,
    match_count: int = 40,
) -> Tuple[List[Dict[str, Any]], str]:
    """(보이는 문서 목록, 사용한 검색 방식)을 돌려준다."""
    rows: Optional[List[Dict[str, Any]]] = None
    method = "rpc"
    if db is not None and db.get_bind().dialect.name == "postgresql":
        try:
            result = db.execute(SCOPED_SEARCH_SQL, {
                "query_embedding": vector_literal(embedding),
                "match_threshold": match_threshold,
                "match_count": match_count,
                "user_id": str(user_id),
                "active_upload_ids": sorted(active_upload_ids),
                "inactive_legacy_sources": sorted(inactive_legacy_sources),
            }).mappings().all()
            rows = [
                {"content": row["content"], "metadata": dict(row["metadata"] or {}), "similarity": float(row["similarity"])}
                for row in result
            ]
            method = "sql"
        except Exception as exc:
            db.rollback()
            logger.warning("scoped vector search failed, falling back to RPC: %s", exc)

    if rows is None:
        if not rag_engine.supabase_client:
            return [], "none"
        response = rag_engine.supabase_client.rpc("match_documents", {
            "query_embedding": embedding,
            "match_threshold": match_threshold,
            "match_count": match_count,
        }).execute()
        rows = response.data or []

    # SQL 경로에서도 한 번 더 걸러 둔다(방어적 이중 확인).
    visible = [
        row for row in rows
        if is_visible(row.get("metadata") or {}, user_id, active_upload_ids, inactive_legacy_sources)
    ]
    return visible, method
