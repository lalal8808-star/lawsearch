import asyncio
import os
import sys

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from api.law_client import law_client
from engine.document_processor import document_processor
from engine.rag import RAGEngine

async def test_precedents():
    print("--- Testing Precedents Integration ---")
    
    # 1. Test LawClient.search_precedents
    print("\n1. Testing LawClient.search_precedents...")
    search_query = "부동산 이중매매"
    search_results = await law_client.search_precedents(search_query)
    prec_list = search_results.get("prec", [])
    if isinstance(prec_list, dict): prec_list = [prec_list]
    
    print(f"Found {len(prec_list)} precedents for '{search_query}'")
    if prec_list:
        first_prec = prec_list[0]
        prec_id = first_prec.get("판례일련번호")
        print(f"Top result: {first_prec.get('사건명')} ({prec_id})")
        
        # 2. Test LawClient.get_precedent_detail
        print("\n2. Testing LawClient.get_precedent_detail...")
        prec_detail = await law_client.get_precedent_detail(prec_id)
        if prec_detail:
            print("Successfully fetched precedent detail.")
            
            # 3. Test DocumentProcessor.process_precedent_xml
            print("\n3. Testing DocumentProcessor.process_precedent_xml...")
            docs = document_processor.process_precedent_xml(prec_detail, prec_id)
            print(f"Processed into {len(docs)} LangChain Documents.")
            if docs:
                print(f"Content snippet: {docs[0].page_content[:200]}...")
                
                # 4. Test RAGEngine query with precedents
                print("\n4. Testing RAGEngine query for report generation...")
                engine = RAGEngine()
                
                # Add the test document to vector store (temporary for test)
                engine.add_documents(docs)
                
                query = "부동산 이중매매의 형사책임에 대해 알려줘"
                result = await engine.query(query)
                
                print(f"\nQuery: {query}")
                print(f"Intent: {result['intent']}")
                print("-" * 50)
                print(f"Answer snippet: {result['answer'][:500]}...")
                print("-" * 50)
                
                sources = [s['source'] for s in result['sources']]
                print(f"Sources: {sources}")
                
                if first_prec.get('사건명') in sources:
                    print("\nSUCCESS: Precedent was used as a source!")
                else:
                    print("\nWARNING: Precedent was not found in sources. This might happen if other statutes were more relevant or k was too small.")
    
    await law_client.close()

if __name__ == "__main__":
    asyncio.run(test_precedents())
