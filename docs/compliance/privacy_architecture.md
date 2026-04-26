# Miwa Privacy & Architecture: Technical Defensibility for Non-Applicability of HIPAA

## Executive Summary
Miwa is architected as a clinical support tool, not a clinical information system (EHR). The design philosophy is "zero-retention of PII/PHI." By stripping clinical inputs of all identifying information *before* it enters our processing layer or storage, Miwa operates outside the scope of traditional "covered entity" electronic health record (EHR) regulatory burdens.

## 1. Core Architectural Constraints
To ensure we do not touch PHI, our systems are governed by the following:

- **Egress Sanitization:** All user inputs pass through a strict `scrub_before_ai()` middleware *before* the application server handles, logs, or processes the request.
- **Ephemeral Processing:** Raw user input is strictly volatile. If it fails the de-identification check, it is discarded. Only the result of the sanitization process is stored, and only if it is confirmed PHI-free.
- **Client-Side/Application-Level Scrubbing:** PHI does not reach our backend database. The sanitization happens at the source.

## 2. Technical Safeguards (The "Filter-First" Model)
1. **Detection Engine:**
   - Multi-stage regex filtering for high-confidence identifiers (SSN, Phone, Email, Date formats).
   - NLP-based named entity recognition (NER) for unstructured clinical entities (e.g., patient names, specific small-geographic identifiers).
2. **Recursive Sanitization:**
   - Any result returned by downstream models is subject to an additional "clean-check." If a model "hallucinates" a name or ID, it is caught at the output filter before returning to the UI.
3. **No Database PHI:**
   - Our database schema is explicitly restricted. Storing PHI is a technical violation of our ingestion pipeline, triggering an immediate alert to system logs (the alert contains metadata, *never* the raw PHI).

## 3. Regulatory Posture: Clinical Support vs. EHR
- **EHR Definition:** A system intended to store, maintain, and retrieve health information for clinical decision-making on identified patients.
- **Miwa Definition:** A clinical support and note-writing augmentation tool. Because we actively destroy patient context, Miwa is a *de-identified productivity tool*. 
- **The "Safe Harbor" Defense:** By systematically stripping the 18 HIPAA identifiers, we reduce the residual risk of identifying any individual to effectively zero.

## 4. Operational Guardrails
- **Continuous Auditing:** Automatic tests run on every commit verify that the sanitization engine correctly identifies and masks PHI.
- **Hardened Ingestion:** Our APIs will refuse requests that contain high-density personal identifiers, essentially forcing the user to scrub their data before it can be effectively used in the workspace.
- **No-Trace Policy:** Logs, while important for engineering, are configured to drop any non-sanitized request body entirely.

---
*Created: 2026-04-07*
*Classification: Internal Technical Architecture*
