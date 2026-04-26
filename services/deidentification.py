import re
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class DeidentifyRequest(BaseModel):
    text: str

class DeidentifyResponse(BaseModel):
    deidentified_text: str
    removed_identifiers: list[str]
    phi_detected: bool

def scrub_before_ai(text: str) -> dict:
    raw_text = text
    
    # 1. Date Transformation (all dates -> in YEAR)
    date_pattern = r'\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4})\b'
    raw_text = re.sub(date_pattern, "in YEAR", raw_text)
    
    # 2. Regex for identifiers
    phone_pattern = r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b'
    raw_text = re.sub(phone_pattern, "[PHONE]", raw_text)
    
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'
    raw_text = re.sub(email_pattern, "[EMAIL]", raw_text)
    
    ssn_pattern = r'\b\d{3}-\d{2}-\d{4}\b'
    raw_text = re.sub(ssn_pattern, "[SSN]", raw_text)
    
    # Check for PHI presence
    removed = []
    if "[PHONE]" in raw_text: removed.append("PHONE")
    if "[EMAIL]" in raw_text: removed.append("EMAIL")
    if "[SSN]" in raw_text: removed.append("SSN")
    if "in YEAR" in raw_text: removed.append("DATE")

    # Fixed Logic: phi_detected is True if we found identifiers
    return {
        "deidentified_text": raw_text,
        "phi_detected": len(removed) > 0,
        "removed_identifiers": removed
    }

@app.post("/deidentify", response_model=DeidentifyResponse)
async def deidentify_endpoint(request: DeidentifyRequest):
    result = scrub_before_ai(request.text)
    return DeidentifyResponse(**result)
