import pytest
from services.deidentification import scrub_before_ai

def test_scrub_phone():
    text = "Patient can be reached at 555-0199."
    result = scrub_before_ai(text)
    assert "[PHONE]" in result["deidentified_text"]
    assert "PHONE" in result["removed_identifiers"]
    assert result["is_deidentified"] is False

def test_scrub_email():
    text = "Contact me at val@miwa.care."
    result = scrub_before_ai(text)
    assert "[EMAIL]" in result["deidentified_text"]
    assert "EMAIL" in result["removed_identifiers"]
    assert result["is_deidentified"] is False

def test_scrub_ssn():
    text = "SSN is 999-00-1234."
    result = scrub_before_ai(text)
    assert "[SSN]" in result["deidentified_text"]

def test_scrub_date():
    text = "Date of visit: 01/15/2026."
    result = scrub_before_ai(text)
    assert "in YEAR" in result["deidentified_text"]

def test_clean_text():
    text = "Patient feels good and reports no symptoms."
    result = scrub_before_ai(text)
    assert result["is_deidentified"] is True
    assert len(result["removed_identifiers"]) == 0
