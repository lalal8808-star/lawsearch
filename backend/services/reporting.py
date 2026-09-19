import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List
from urllib.parse import quote


LAW_SUFFIXES = ("법", "령", "규칙", "률")


def is_law_source(source: Dict[str, Any]) -> bool:
    name = str(source.get("source") or "").strip()
    source_type = str(source.get("type") or "").lower()
    return source_type == "law" or (
        source_type != "user_upload"
        and bool(name)
        and (name.endswith(LAW_SUFFIXES) or "법 [" in name or "령 [" in name)
    )


def clean_law_name(name: str) -> str:
    return (name or "").split(" [", 1)[0].strip()


def build_evidence_manifest(sources: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize report sources into a stable, auditable evidence ledger."""
    retrieved_at = datetime.now(timezone.utc).isoformat()
    manifest: List[Dict[str, Any]] = []
    seen = set()

    for raw in sources or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("source") or "").strip()
        if not name:
            continue
        source_type = str(raw.get("type") or "document")
        article_no = raw.get("article_no")
        key = (name, source_type, str(article_no or ""))
        if key in seen:
            continue
        seen.add(key)

        law_source = is_law_source(raw)
        url = raw.get("url")
        if law_source and not url:
            url = f"https://www.law.go.kr/법령/{quote(clean_law_name(name))}"

        manifest.append({
            "source": name,
            "type": source_type,
            "article_no": article_no,
            "mst": raw.get("mst"),
            "url": url,
            "retrieved_at": raw.get("retrieved_at") or retrieved_at,
            "verification": (
                "user_provided" if source_type == "user_upload"
                else "pending_article_check" if law_source
                else "retrieved"
            ),
            "upload_id": raw.get("upload_id"),
            "version": raw.get("version"),
        })
    return manifest


def extract_answer_preview(answer: str, limit: int = 180) -> str:
    compact = re.sub(r"\s+", " ", answer or "").strip()
    return compact if len(compact) <= limit else compact[: limit - 1].rstrip() + "…"


def sanitize_chat_history(messages: Iterable[Dict[str, Any]], max_messages: int = 100) -> List[Dict[str, str]]:
    clean: List[Dict[str, str]] = []
    total_chars = 0
    for item in list(messages or [])[-max_messages:]:
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
            continue
        content = str(item.get("content") or "").strip()[:20000]
        if not content:
            continue
        total_chars += len(content)
        if total_chars > 200000:
            break
        clean.append({"role": item["role"], "content": content})
    return clean
