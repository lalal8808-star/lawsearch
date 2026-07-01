import os
import re
import asyncio
import base64
import logging
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_core.messages import SystemMessage, HumanMessage
from typing import List, Dict, Any, Optional
from supabase.client import create_client, Client

load_dotenv()

logger = logging.getLogger(__name__)

# RAG and Vector DB Configuration
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not GOOGLE_API_KEY:
    print("CRITICAL ERROR: GOOGLE_API_KEY is not set in environment variables!")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("WARNING: Supabase credentials not fully set. Vector store may not function.")

class RAGEngine:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass

    def __init__(self):
        if not GOOGLE_API_KEY:
            raise ValueError("GOOGLE_API_KEY is required but found None. Check your Render Environment Variables.")
            
        # gemini-embedding-001 기본 출력은 3072차원인데 Supabase documents.embedding
        # 컬럼은 vector(768)이라 insert가 'expected 768 dimensions, not 3072'로 거부된다.
        # 저장·검색 임베딩을 모두 768차원으로 맞춘다.
        self.embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=GOOGLE_API_KEY,
            output_dimensionality=768
        )
        
        self.supabase_client: Optional[Client] = None
        
        if SUPABASE_URL and SUPABASE_KEY:
            self.supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
            print("Supabase client initialized.")
        else:
            print("Supabase client NOT initialized due to missing credentials.")

        # 백엔드 보조 LLM(detect_intent / detect_required_laws / filter_relevant_uploads)은
        # 임베딩과 동일하게 Gemini(GOOGLE_API_KEY)를 사용한다. 메인 채팅/보고서 생성은
        # 프론트에서 Vercel AI Gateway(gpt-5.5)로 처리하므로 백엔드엔 OpenAI 키가 필요 없다.
        self.chat_llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            temperature=0.7,
            google_api_key=GOOGLE_API_KEY,
        )
        self.report_llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            temperature=0,
            google_api_key=GOOGLE_API_KEY,
        )
        self._metadata_cache = None # Stores {'sources': set(), 'msts': set()}

    def _refresh_metadata_cache(self):
        """
        Refresh the memory cache of synced sources and MSTs.
        Using Supabase client for efficient metadata fetching.
        """
        try:
            print("Refreshing metadata cache via Supabase...")
            if not self.supabase_client:
                self._metadata_cache = {'sources': set(), 'msts': set()}
                return

            # Fetch distinct sources and msts from metadata column
            # Note: Supabase/PostgreSQL doesn't easily support distinct on JSONB fields without complex queries.
            # We'll fetch the last 1000 items and extract metadata manually for the cache.
            response = self.supabase_client.table("documents").select("metadata").limit(1000).execute()
            
            sources = set()
            msts = set()
            for row in response.data:
                meta = row.get('metadata', {})
                if not meta: continue
                if 'source' in meta: sources.add(meta['source'])
                if 'mst' in meta: msts.add(str(meta['mst']))
            self._metadata_cache = {'sources': sources, 'msts': msts}
        except Exception as e:
            print(f"Error refreshing metadata cache: {e}")
            self._metadata_cache = {'sources': set(), 'msts': set()}

    def _normalize_content(self, content: Any) -> str:
        """
        Robustly convert LangChain response content to a clean string.
        Handles strings, lists (multiple blocks), and potentially dicts.
        """
        if isinstance(content, str):
            # Already a string, just clean up potential backslash escapes if LLM over-escaped
            # Note: We replace literal \" and \' with " and '
            return content.replace('\\"', '"').replace("\\'", "'")
        
        if isinstance(content, list):
            # Aggregate text from blocks
            text_parts = []
            for part in content:
                if isinstance(part, str):
                    text_parts.append(part)
                elif isinstance(part, dict):
                    text_parts.append(part.get("text", str(part)))
                else:
                    text_parts.append(str(part))
            full_text = "".join(text_parts)
            return full_text.replace('\\"', '"').replace("\\'", "'")
            
        if isinstance(content, dict):
            return content.get("text", str(content)).replace('\\"', '"').replace("\\'", "'")
            
        return str(content).replace('\\"', '"').replace("\\'", "'")

    def _get_synced_sources(self) -> List[str]:
        if self._metadata_cache is None:
            self._refresh_metadata_cache()
        return list(self._metadata_cache['sources'])

    def get_synced_msts(self) -> List[str]:
        if self._metadata_cache is None:
            self._refresh_metadata_cache()
        return list(self._metadata_cache['msts'])

    async def add_documents(self, documents: List[Document], user_id: Optional[int] = None):
        """
        Add documents to the vector store with chunking and direct Supabase insertion.
        """
        if not self.supabase_client:
            print("Warning: Cannot add documents. Supabase client not initialized.")
            return

        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
        chunks = text_splitter.split_documents(documents)
        if chunks:
            print(f"Adding {len(chunks)} chunks to Supabase...")
            try:
                # Batch processing for stability and speed
                batch_size = 50
                for i in range(0, len(chunks), batch_size):
                    batch = chunks[i:i+batch_size]

                    # Embed the whole batch in one call instead of per-chunk requests
                    texts = [doc.page_content for doc in batch]
                    embeddings = await self.embeddings.aembed_documents(texts)

                    records = []
                    for doc, embedding in zip(batch, embeddings):
                        if user_id is not None:
                            doc.metadata["user_id"] = user_id
                        records.append({
                            "content": doc.page_content,
                            "metadata": doc.metadata,
                            "embedding": embedding
                        })

                    if records:
                        self.supabase_client.table("documents").insert(records).execute()

                # Invalidate cache
                self._metadata_cache = None
                print(f"Successfully added {len(chunks)} chunks.")
            except Exception as e:
                # Runs in a background task; log instead of bubbling to a dead request
                print(f"Error adding documents: {e}")

    def delete_documents_by_mst(self, mst: str):
        """
        Delete documents with a specific MST from the vector store.
        """
        try:
            if not self.supabase_client: return
            
            # Direct deletion via Supabase client for metadata filtering
            # documents.metadata @> '{"mst": "..."}'
            self.supabase_client.table("documents").delete().filter("metadata->>mst", "eq", str(mst)).execute()
            print(f"Deleted segments for MST {mst} from Supabase")
            # Invalidate cache
            self._metadata_cache = None
        except Exception as e:
            print(f"Error deleting documents: {e}")


    async def recommend_laws(self, case_description: str) -> List[str]:
        """
        Recommend relevant laws based on a case description (using ainvoke).
        """
        messages = [
            SystemMessage(content="당신은 대한민국 법률 전문가입니다. 아래 사례를 해결하기 위해 반드시 검토해야 할 대한민국 법령 10가지를 추천하십시오. 형식: 법령 명칭만 쉼표(,)로 구분. 추가 설명 생략."),
            HumanMessage(content=f"사례: {case_description}")
        ]
        try:
            response = await self.report_llm.ainvoke(messages)
            content = self._normalize_content(response.content)
                
            import re
            raw_list = re.split(r'[,|\n]', content)
            recommendations = [law.strip() for law in raw_list if law.strip()]
            return recommendations[:10]
        except Exception as e:
            print(f"Error in recommend_laws: {e}")
            return []

    async def detect_required_laws(self, user_query: str) -> List[str]:
        """
        Detect law names in the query that might need to be synced (using ainvoke).
        """
        messages = [
            SystemMessage(content="질문에 답변하기 위해 참조해야 하는 대한민국의 법령 명칭을 추출하십시오. 형식: 법령 명칭만 쉼표(,)로 구분. 없으면 'None'."),
            HumanMessage(content=f"질문: {user_query}")
        ]
        try:
            response = await self.report_llm.ainvoke(messages)
            content = self._normalize_content(response.content)
                
            if "None" in content or not content.strip():
                return []
                
            import re
            laws = [l.strip() for l in re.split(r'[,|\n]', content) if l.strip()]
            return [l for l in laws if l and l.lower() != 'none']
        except Exception as e:
            print(f"Error in detect_required_laws: {e}")
            return []

    async def detect_intent(self, user_query: str) -> str:
        """
        Classify query as CHAT or REPORT (using ainvoke).
        """
        system = (
            "사용자 메시지를 'CHAT' 또는 'REPORT' 한 단어로만 분류하라.\n"
            "- REPORT: 법률 자문·분석·검토가 필요한 실질적 질문(사건, 절차, 기준, 요건, 인허가, "
            "책임, 제재, 계약, 권리 등). 짧아도 법적 판단이 필요하면 REPORT.\n"
            "- CHAT: 단순 인사, 잡담, 서비스 사용법, 매우 짧은 후속 확인 등 법적 분석이 불필요한 경우.\n"
            "오직 한 단어(CHAT 또는 REPORT)만 답하라."
        )
        messages = [
            SystemMessage(content=system),
            HumanMessage(content=f"메시지: {user_query}")
        ]
        try:
            response = await self.chat_llm.ainvoke(messages)
            content = self._normalize_content(response.content).strip().upper()
            logger.info(f"detect_intent LLM output='{content}' for query='{user_query[:50]}'")
            return "REPORT" if "REPORT" in content else "CHAT"
        except Exception as e:
            print(f"Error in detect_intent: {e}")
            return "REPORT"

    async def filter_relevant_uploads(self, user_query: str, sources: List[str]) -> set:
        """
        업로드 자료(파일 제목)가 질문과 직접 관련 있는지 LLM으로 판단한다.
        임베딩 유사도만으로는 같은 도메인(예: '변전공사' vs '지중송전')이 0.7로 붙어버려
        구분이 안 되므로, 제목 기반으로 LLM이 주제 일치를 판단하게 한다.
        관련된 source 이름 집합을 반환(무관하면 빈 집합).
        """
        sources = list(dict.fromkeys([s for s in sources if s]))  # 중복 제거(순서 유지)
        if not sources:
            return set()
        listing = "\n".join(f"{i+1}. {s}" for i, s in enumerate(sources))
        messages = [
            SystemMessage(content=(
                "사용자 질문과 첨부 자료 제목 목록이 주어진다. 질문에 직접 관련된 자료의 번호만 "
                "쉼표로 답하라. 주제가 다르면(예: 질문은 '변전공사'인데 자료는 '지중송전 관련') 제외한다. "
                "관련된 것이 하나도 없으면 'None'만 답하라. 다른 설명은 하지 마라."
            )),
            HumanMessage(content=f"질문: {user_query}\n\n자료 목록:\n{listing}")
        ]
        try:
            response = await self.chat_llm.ainvoke(messages)
            content = self._normalize_content(response.content).strip()
            if "none" in content.lower():
                return set()
            nums = [int(n) for n in re.findall(r'\d+', content)]
            relevant = {sources[n - 1] for n in nums if 1 <= n <= len(sources)}
            logger.info(f"[relevance] query='{user_query[:40]}' relevant_uploads={relevant}")
            return relevant
        except Exception as e:
            print(f"Error in filter_relevant_uploads: {e}")
            return set(sources)  # 판단 실패 시 관련 데이터 유실 방지 위해 유지(유사도 게이트는 이미 적용됨)

    def get_article_text(self, law_name: str, article_no: str) -> Optional[str]:
        """
        Retrieve the full text of a specific article from a law.
        """
        try:
            if not self.supabase_client: return None
            
            # article_no might be "제750조" or "제750"
            if not article_no.startswith("제"):
                article_no = "제" + article_no
            if not article_no.endswith("조"):
                article_no = article_no + "조"

            # Filter by source and article_no in metadata JSONB
            response = self.supabase_client.table("documents") \
                .select("content") \
                .filter("metadata->>source", "eq", law_name) \
                .filter("metadata->>article_no", "eq", article_no) \
                .limit(1) \
                .execute()
            
            if response.data:
                return response.data[0]['content']
            
            # Fallback: simple vector search via RPC if metadata filter fails
            query_embedding = self.embeddings.embed_query(f"[{law_name}] {article_no}")
            rpc_params = {
                "query_embedding": query_embedding,
                "match_threshold": 0.5,
                "match_count": 1,
            }
            fallback_response = self.supabase_client.rpc("match_documents", rpc_params).execute()
            
            if fallback_response.data:
                item = fallback_response.data[0]
                if law_name in item.get("metadata", {}).get("source", ""):
                    return item.get("content")

            return None
        except Exception as e:
            print(f"Error retrieving article text: {e}")
            return None

    def get_user_uploads(self, user_id: int) -> List[str]:
        """
        Retrieve unique source names for user-uploaded documents.
        """
        try:
            if not self.supabase_client: return []
            
            response = self.supabase_client.table("documents") \
                .select("metadata") \
                .filter("metadata->>type", "eq", "user_upload") \
                .filter("metadata->>user_id", "eq", str(user_id)) \
                .execute()
                
            sources = set()
            for row in response.data:
                meta = row.get('metadata', {})
                if meta and 'source' in meta:
                    sources.add(meta['source'])
            return sorted(list(sources))
        except Exception as e:
            print(f"Error getting user uploads: {e}")
            return []

    def delete_user_upload(self, source_name: str, user_id: int):
        """
        Delete all segments of a specific user-uploaded source.
        """
        try:
            if not self.supabase_client: return
            
            self.supabase_client.table("documents") \
                .delete() \
                .filter("metadata->>type", "eq", "user_upload") \
                .filter("metadata->>source", "eq", source_name) \
                .filter("metadata->>user_id", "eq", str(user_id)) \
                .execute()
                
            print(f"Deleted segments for uploaded source: {source_name} from Supabase")
            self._metadata_cache = None
        except Exception as e:
            print(f"Error deleting user upload {source_name}: {e}")


rag_engine = RAGEngine()
