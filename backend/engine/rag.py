import os
import re
import asyncio
import base64
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from typing import List, Dict, Any, Optional
from supabase.client import create_client, Client

load_dotenv()

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
            
        # Revert to gemini-embedding-001 for stability
        self.embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=GOOGLE_API_KEY
        )
        
        self.supabase_client: Optional[Client] = None
        
        if SUPABASE_URL and SUPABASE_KEY:
            self.supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
            print("Supabase client initialized.")
        else:
            print("Supabase client NOT initialized due to missing credentials.")

        self.chat_llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash-lite", 
            temperature=0.7,
            google_api_key=GOOGLE_API_KEY
        )
        self.report_llm = ChatGoogleGenerativeAI(
            model="gemini-3-pro-preview",
            temperature=0,
            google_api_key=GOOGLE_API_KEY
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

    async def add_documents(self, documents: List[Document]):
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
            # Batch processing for stability
            batch_size = 50
            for i in range(0, len(chunks), batch_size):
                batch = chunks[i:i+batch_size]
                
                # Prepare data for direct Supabase insert
                records = []
                for doc in batch:
                    embedding = await self.embeddings.aembed_query(doc.page_content)
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
        prompt = f"""
        당신은 대한민국 법률 전문가입니다. 아래 사례를 해결하기 위해 반드시 검토해야 할 대한민국 법령 10가지를 추천하십시오.
        사례: {case_description}
        형식: 법령 명칭만 쉼표(,)로 구분. 추가 설명 생략.
        """
        response = await self.report_llm.ainvoke(prompt)
        content = self._normalize_content(response.content)
            
        import re
        raw_list = re.split(r'[,|\n]', content)
        recommendations = [law.strip() for law in raw_list if law.strip()]
        return recommendations[:10]

    async def detect_required_laws(self, user_query: str) -> List[str]:
        """
        Detect law names in the query that might need to be synced (using ainvoke).
        """
        prompt = f"""
        질문에 답변하기 위해 참조해야 하는 대한민국의 법령 명칭을 추출하십시오.
        질문: {user_query}
        형식: 법령 명칭만 쉼표(,)로 구분. 없으면 'None'.
        """
        response = await self.report_llm.ainvoke(prompt)
        content = self._normalize_content(response.content)
            
        if "None" in content or not content.strip():
            return []
            
        import re
        laws = [l.strip() for l in re.split(r'[,|\n]', content) if l.strip()]
        return [l for l in laws if l and l.lower() != 'none']

    async def detect_intent(self, user_query: str) -> str:
        """
        Classify query as CHAT or REPORT (using ainvoke).
        """
        prompt = f"""
        질문을 분석하여 'CHAT' 또는 'REPORT'로 분류하십시오.
        질문: {user_query}
        답변: 오직 단어 하나만 반환.
        """
        try:
            response = await self.chat_llm.ainvoke(prompt)
            content = self._normalize_content(response.content).strip().upper()
            logger.info(f"DEBUG: detect_intent LLM output='{content}' for query='{user_query[:50]}...'")
            # Be more flexible: if it looks like a report request, it's a report
            is_report = "REPORT" in content or "REPORT" in user_query.upper() or len(user_query) > 20
            return "REPORT" if is_report else "CHAT"
        except Exception as e:
            print(f"Error in detect_intent: {e}")
            return "REPORT"

    async def query(self, user_query: str, target_laws: List[str] = None) -> Dict[str, Any]:
        """
        Modernized legal query (Fully Anonymous, Async, and Re-ranked).
        """
        # 1. Intent Detection
        intent = await self.detect_intent(user_query)
        
        # 2. Retrieval Setup (k=15 for precision)
        search_kwargs = {"k": 15}
        target_sources = target_laws or []
        all_synced_sources = self._get_synced_sources()
        for s in all_synced_sources:
            if s in user_query and s not in target_sources:
                target_sources.append(s)

        if target_sources:
            search_kwargs["filter"] = {
                "$or": [
                    {"source": {"$in": target_sources}},
                    {"type": "user_upload"},
                    {"type": "precedent"}
                ]
            }

        try:
            if not self.supabase_client:
                return {
                    "answer": "죄송합니다. 현재 법률 데이터베이스(Vector DB)가 연결되어 있지 않아 정확한 검토가 어렵습니다. 관리자에게 문의하여 Supabase 설정을 확인해주세요.",
                    "sources": [],
                    "intent": intent,
                    "engine": "Fallback"
                }

            # 3. Direct RPC call to bypass LangChain's buggy SupabaseVectorStore retriever
            # This fix is robust against version conflicts between langchain-community and supabase-py
            query_embedding = await self.embeddings.aembed_query(user_query)
            
            rpc_params = {
                "query_embedding": query_embedding,
                "match_threshold": 0.3, # Permissive threshold for initial retrieval
                "match_count": 25,      # Fetch more for manual Python-side filtering
            }
            
            # Use direct RPC call
            rpc_response = self.supabase_client.rpc("match_documents", rpc_params).execute()
            
            docs = []
            for item in rpc_response.data:
                metadata = item.get("metadata", {})
                content = item.get("content", "")
                
                # Apply filters manually to ensure consistent behavior
                if target_sources:
                    is_target = metadata.get("source") in target_sources
                    is_upload = metadata.get("type") == "user_upload"
                    is_precedent = metadata.get("type") == "precedent"
                    if not (is_target or is_upload or is_precedent):
                        continue
                
                docs.append(Document(page_content=content, metadata=metadata))
            
            # 4. Limit to top results and constructed context
            docs = docs[:15]
            
            # 5. Dynamic Re-ranking
            keywords = [k for k in re.split(r'\s+', user_query) if len(k) > 1]
            for doc in docs:
                doc.metadata['boost'] = sum(10 for kw in keywords if kw in doc.page_content)
            
            docs = sorted(docs, key=lambda x: x.metadata.get('boost', 0), reverse=True)

            # 6. Prompt Construction
            context_parts = []
            seen_contents = set()
            sources_list = []
            
            # Pre-populate sources with target laws to ensure they appear even if no docs matched
            if target_laws:
                for tlaw in target_laws:
                    if tlaw and tlaw.lower() != 'none':
                        sources_list.append({"source": tlaw, "type": "law"})

            for doc in docs:
                content = doc.page_content.strip()
                src = doc.metadata.get("source", "Unknown").strip()
                src_type = doc.metadata.get("type", "unknown")
                
                if content not in seen_contents:
                    context_parts.append(f"[{src}] {content}")
                    seen_contents.add(content)
                    if src not in [s['source'] for s in sources_list]:
                        sources_list.append({"source": src, "type": src_type})

            context = "\n\n".join(context_parts[:10])
            
            # 5. Persona & Prompt Construction
            persona = """
            당신의 이름은 'JongLaw AI'입니다. 
            당신은 사용자의 법률 질의를 변호사 수준의 체계적인 법률 검토 프로세스로 처리하여, 구조화된 법률 검토 보고서를 생성 및 제공하는 전문 법률 어시스턴트입니다.
            """

            if intent == "CHAT":
                final_prompt = f"{persona}\n\n질문: {user_query}\n\n참고 법령 및 판례:\n{context}\n\n위 가이드라인에 따라 친절하고 전문적으로 답변하십시오."
                llm = self.chat_llm
            else:
                final_prompt = f"{persona}\n\n질문: {user_query}\n\n참고 법령 및 자료(판례 포함):\n{context}\n\n전문 변호사로서 [사건 개요, 법률 분석, 판례 분석, 결론, 향후 조치] 순서로 체계적인 자문 리포트를 작성하십시오. 특히 제공된 '판례'를 분석하여 유사 사례에서의 판단 기준을 명확히 제시하십시오."
                llm = self.report_llm

            response = await llm.ainvoke(final_prompt)
            
            return {
                "answer": self._normalize_content(response.content),
                "sources": sources_list,
                "intent": intent,
                "engine": llm.model_name if hasattr(llm, 'model_name') else llm.model
            }
        except Exception as e:
            print(f"Error in modernized query [v2-rpc-fix]: {e}")
            raise e

    async def query_followup(self, user_query: str, report_context: str, chat_history: List[Dict[str, str]]) -> Dict[str, Any]:
        """
        Deep follow-up Q&A based on a specific report.
        """
        history_text = "\n".join([f"{m['role'].upper()}: {m['content']}" for m in chat_history])
        
        prompt = f"""
        당신은 앞서 작성된 법률 리포트에 대해 심층적인 답변을 제공하는 전문 법률 어시스턴트 'JongLaw AI'입니다.
        
        [리포트 원문 내용]
        {report_context}
        
        [이전 대화 내역]
        {history_text}
        
        [현재 질문]
        {user_query}
        
        가이드라인:
        1. 리포트의 내용을 바탕으로 질문에 대해 구체적이고 전문적으로 답변하십시오.
        2. 리포트에 언급된 특정 용어(예: '부당이득', '불법행위' 등)나 법리가 있다면 그 맥락을 유지하며 설명하십시오.
        3. 이전 대화의 흐름이 있다면 이를 고려하여 답변하십시오.
        4. 답변은 친절하고 정중한 전문 변호사의 어조를 유지하십시오.
        """
        
        try:
            response = await self.chat_llm.ainvoke(prompt)
            return {
                "answer": self._normalize_content(response.content),
                "model": self.chat_llm.model_name if hasattr(self.chat_llm, 'model_name') else self.chat_llm.model
            }
        except Exception as e:
            print(f"Error in follow-up query: {e}")
            raise e

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

    def get_user_uploads(self) -> List[str]:
        """
        Retrieve unique source names for user-uploaded documents.
        """
        try:
            if not self.supabase_client: return []
            
            response = self.supabase_client.table("documents") \
                .select("metadata") \
                .filter("metadata->>type", "eq", "user_upload") \
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

    def delete_user_upload(self, source_name: str):
        """
        Delete all segments of a specific user-uploaded source.
        """
        try:
            if not self.supabase_client: return
            
            self.supabase_client.table("documents") \
                .delete() \
                .filter("metadata->>type", "eq", "user_upload") \
                .filter("metadata->>source", "eq", source_name) \
                .execute()
                
            print(f"Deleted segments for uploaded source: {source_name} from Supabase")
            self._metadata_cache = None
        except Exception as e:
            print(f"Error deleting user upload {source_name}: {e}")


class VisionEngine:
    def __init__(self):
        # Using gemini-2.0-flash-lite which supports multimodal
        self.vision_llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash-lite", 
            temperature=0,
            google_api_key=GOOGLE_API_KEY
        )

    async def analyze_contract_document(self, image_bytes: Optional[bytes] = None, text_content: Optional[str] = None, user_description: str = "") -> Dict[str, Any]:
        """
        Analyze a contract document (Image or PDF text) using Gemini.
        Identifies toxic clauses and missing items.
        """
        content_parts = []
        
        # Base prompt
        base_prompt = f"""
        당신은 대한민국 전문 변호사입니다. 제공된 계약서(또는 법률 문서)를 정밀 분석하여 다음 정보를 추출하고 분석하십시오.
        
        사용자 추가 설명: {user_description if user_description else "없음"}

        분석 요구사항:
        1. **문서 종류 식별**: 이 문서가 어떤 종류의 계약서인지 파악하십시오.
        2. **독소 조항(Toxic Clauses) 추출**: 사용자에게 일방적으로 불리하거나, 법적으로 문제가 될 소지가 있는 조항을 모두 찾아내어 설명하십시오.
        3. **누락된 필수 항목**: 해당 계약 종류에서 통상적으로 포함되어야 하나 누락된 중요한 항목이 있다면 지적하십시오.
        4. **종합 의견 및 권고 사항**: 이 계약을 체결할 때 주의해야 할 점과 수정 제안을 제공하십시오.

        출력 형식 (JSON):
        {{
            "document_type": "문서 종류",
            "toxic_clauses": [
                {{"clause": "조항 내용 (또는 위치)", "reason": "불리하거나 위험한 이유", "suggestion": "수정 제안"}}
            ],
            "missing_items": ["누락된 항목 1", "누락된 항목 2"],
            "overall_opinion": "종합적인 변호사 의견",
            "risk_level": "고/중/저"
        }}

        반드시 유효한 JSON 형식으로만 답변하십시오. 한국어로 작성하십시오.
        """
        content_parts.append({"type": "text", "text": base_prompt})

        if text_content:
            content_parts.append({"type": "text", "text": f"\n\n[계약서 텍스트 내용]\n{text_content}"})

        if image_bytes:
            # Convert image bytes to base64
            image_base64 = base64.b64encode(image_bytes).decode("utf-8")
            content_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
            })

        message = {
            "role": "user",
            "content": content_parts,
        }

        try:
            response = await self.vision_llm.ainvoke([message])
            content = self._normalize_json_content(response.content)
            import json
            return json.loads(content)
        except Exception as e:
            print(f"Error in VisionEngine analysis: {e}")
            return {
                "error": "문서 분석 중 오류가 발생했습니다.",
                "detail": str(e)
            }

    def _normalize_json_content(self, content: str) -> str:
        """
        Extract JSON block from LLM response if present.
        """
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        return content.strip()

rag_engine = RAGEngine()
vision_engine = VisionEngine()
