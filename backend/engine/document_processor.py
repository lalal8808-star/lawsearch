import io
import PyPDF2
from langchain_core.documents import Document
from typing import List, Dict, Any

class DocumentProcessor:
    @staticmethod
    def process_law_xml(law_data: Dict[str, Any], mst: str) -> List[Document]:
        """
        Convert law XML data to LangChain Documents.
        Focuses on the body text (조문).
        """
        docs = []
        law_name = law_data.get("기본정보", {}).get("법령명_한글", "Unknown Law")
        
        # Process 조문 (Articles)
        jo_list = law_data.get("조문", {}).get("조문단위", [])
        if isinstance(jo_list, dict):
            jo_list = [jo_list]
            
        for jo in jo_list:
            jo_title = jo.get("조문제목", "")
            jo_content = jo.get("조문내용", "")
            full_text = f"[{law_name}] {jo_title}\n{jo_content}"
            
            # Extract article number for metadata (e.g., from "제1조(목적)" extract "제1조")
            import re
            article_match = re.search(r'제\d+조(?:의\d+)?', jo_title)
            article_no = article_match.group(0) if article_match else ""

            # Add 항 (Paragraphs) if any
            hang_list = jo.get("항", [])
            if isinstance(hang_list, dict):
                hang_list = [hang_list]
            
            for hang in hang_list:
                hang_no = hang.get("항번호", "")
                hang_content = hang.get("항내용", "")
                full_text += f"\n{hang_no}. {hang_content}"
                
                # Add 호 (Items)
                ho_list = hang.get("호", [])
                if isinstance(ho_list, dict):
                    ho_list = [ho_list]
                for ho in ho_list:
                    ho_no = ho.get("호번호", "")
                    ho_content = ho.get("호내용", "")
                    full_text += f"\n  {ho_no}. {ho_content}"
                    
                    # Add 목 (Sub-items)
                    mok_list = ho.get("목", [])
                    if isinstance(mok_list, dict):
                        mok_list = [mok_list]
                    for mok in mok_list:
                        mok_no = mok.get("목번호", "")
                        mok_content = mok.get("목내용", "")
                        full_text += f"\n    {mok_no}. {mok_content}"
            
            docs.append(Document(
                page_content=full_text,
                metadata={
                    "source": law_name, 
                    "mst": mst, 
                    "article_no": article_no,
                    "type": "law",
                    "url": f"https://www.law.go.kr/법령/{law_name}"
                }
            ))
            
        return docs

    @staticmethod
    def process_precedent_xml(prec_data: Dict[str, Any], prec_id: str) -> List[Document]:
        """
        Convert precedent XML data to LangChain Documents.
        """
        docs = []
        case_name = prec_data.get("사건명", "Unknown Case")
        case_no = prec_data.get("사건번호", "Unknown No")
        court_name = prec_data.get("법원명", "Unknown Court")
        judgment_date = prec_data.get("선고일자", "")
        judgment_type = prec_data.get("선고", "")
        
        # Combine sections for indexing
        # 판례정보 contains: 판결요지, 판시사항, 전문 (full text)
        yoji = prec_data.get("판결요지", "")
        sahang = prec_data.get("판시사항", "")
        jeonmun = prec_data.get("전문", "")
        
        full_text = f"[{case_name} ({case_no})] {court_name} {judgment_date} {judgment_type}\n"
        if sahang:
            full_text += f"\n[판시사항]\n{sahang}"
        if yoji:
            full_text += f"\n[판결요지]\n{yoji}"
        if jeonmun:
            # Full text can be very long, but we'll include it. 
            # RAG will chunk it later if needed.
            full_text += f"\n[전문]\n{jeonmun}"

        docs.append(Document(
            page_content=full_text,
            metadata={
                "source": case_name,
                "case_no": case_no,
                "prec_id": prec_id,
                "type": "precedent",
                "court": court_name,
                "date": judgment_date,
                "url": f"https://www.law.go.kr/판례/{prec_id}"
            }
        ))
        
        return docs

    @staticmethod
    def process_pdf(file_content: bytes, filename: str) -> List[Document]:
        """
        Extract text from PDF and convert to LangChain Documents.
        """
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(file_content))
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text() + "\n"
            
        return [Document(
            page_content=text,
            metadata={"source": filename, "type": "user_upload"}
        )]

document_processor = DocumentProcessor()
