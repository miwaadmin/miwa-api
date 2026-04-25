'use strict';

/**
 * PHI Scrubber — HIPAA Safe Harbor De-Identification
 *
 * Scrubs the 18 HIPAA Safe Harbor identifier categories from clinical text
 * before it is sent to the configured Azure OpenAI deployment.
 *
 * This is a defense-in-depth layer. The primary protection is Miwa's
 * de-identified-only workflow policy. This scrubber is the technical backstop
 * that catches PHI which slips through.
 *
 * Architecture:
 *   Layer 1 — Structural PHI   (very high confidence: SSN, phone, email, dates, etc.)
 *   Layer 2 — Labeled PHI      (high confidence: "Name:", "DOB:", "MRN:", etc.)
 *   Layer 3 — Titled names     (high confidence: Dr. Smith, Mr. Jones)
 *   Layer 4 — Contextual names (medium confidence: "patient Sarah", "referred by John")
 *   Layer 5 — Common name list (catches standalone first names in non-sentence positions)
 */

// ── Replacement tokens ────────────────────────────────────────────────────────
const T = {
  NAME    : '[NAME]',
  PHONE   : '[PHONE]',
  FAX     : '[FAX]',
  EMAIL   : '[EMAIL]',
  SSN     : '[SSN]',
  DATE    : '[DATE]',
  DOB     : '[DATE-OF-BIRTH]',
  ADDR    : '[ADDRESS]',
  ZIP     : '[ZIP]',
  MRN     : '[MRN]',
  NPI     : '[NPI]',
  URL     : '[URL]',
  IP      : '[IP-ADDRESS]',
  ACCOUNT : '[ACCOUNT-NUMBER]',
  LICENSE : '[LICENSE-NUMBER]',
  CREDIT  : '[PAYMENT-INFO]',
  VEHICLE : '[VEHICLE-ID]',
  DEVICE  : '[DEVICE-ID]',
  BIOMETRIC: '[BIOMETRIC-ID]',
};

// ── Common first names (top ~400 US first names, both genders) ────────────────
// Used in Layer 5 to catch standalone names that appear without title or context.
const COMMON_NAMES = new Set([
  // Male
  'james','john','robert','michael','william','david','richard','joseph','thomas','charles',
  'christopher','daniel','matthew','anthony','mark','donald','steven','paul','andrew','joshua',
  'kenneth','kevin','brian','george','timothy','ronald','edward','jason','jeffrey','ryan',
  'jacob','gary','nicholas','eric','jonathan','stephen','larry','justin','scott','brandon',
  'benjamin','samuel','gregory','frank','alexander','patrick','jack','dennis','jerry','tyler',
  'aaron','jose','adam','nathan','henry','zachary','douglas','peter','kyle','noah','ethan',
  'jeremy','walter','christian','keith','roger','terry','austin','sean','gerald','harold',
  'carl','arthur','lawrence','dylan','jesse','alan','jordan','bryan','billy','ralph','roy',
  'eugene','wayne','louis','juan','carlos','antonio','xavier','marcus','andre','darius',
  'elijah','isaiah','caleb','lucas','mason','logan','liam','oliver','aiden','jackson',
  'sebastian','leo','carter','owen','gabriel','jayden','levi','isaac','lincoln','grayson',
  'julian','eli','easton','brayden','colton','landon','theo','felix','roman','malachi',
  'axel','bentley','bodhi','beau','miles','finn','silas','jasper','nolan','ryder',
  // Female
  'mary','patricia','jennifer','linda','barbara','elizabeth','susan','jessica','sarah','karen',
  'lisa','nancy','betty','margaret','sandra','ashley','dorothy','kimberly','emily','donna',
  'michelle','carol','amanda','melissa','deborah','stephanie','rebecca','sharon','laura',
  'cynthia','kathleen','amy','angela','shirley','anna','brenda','pamela','emma','nicole',
  'helen','samantha','katherine','christine','debra','rachel','carolyn','janet','catherine',
  'maria','heather','diane','julie','joyce','victoria','kelly','christina','lauren','joan',
  'evelyn','olivia','judith','megan','cheryl','andrea','hannah','martha','jacqueline',
  'frances','gloria','ann','kathryn','alice','jean','diana','rose','janice','julia',
  'marie','madison','teresa','abigail','sophia','lori','grace','judy','theresa','beverly',
  'denise','marilyn','amber','danielle','brittany','isabella','natalie','charlotte','claire',
  'ruby','alexis','tiffany','crystal','brianna','kayla','hailey','taylor','paige','vanessa',
  'miranda','faith','autumn','sierra','shelby','destiny','chelsea','jasmine','brooke',
  'ava','mia','luna','gianna','aria','ellie','layla','chloe','penelope','riley',
  'zoey','nora','lily','eleanor','hannah','addison','aubrey','nova','brooklyn','leah',
  'savannah','audrey','bella','skylar','lucy','scarlett','isla','sofia','caroline','kennedy',
  'maya','elena','naomi','kinsley','aaliyah','ariana','hazel','piper','violet','quinn',
  // Names that are also used clinically but commonly appear as names
  'april','june','joy','grace','faith','hope','dawn','crystal','summer','sandy','misty',
]);

// ── LAYER 1 & 2: Regex rules (applied in strict order) ───────────────────────
// Each rule has: label (for logging), pattern (RegExp), replacement (string or fn)
const RULES = [

  // ── SSN ────────────────────────────────────────────────────────────────────
  // 123-45-6789 | 123 45 6789 | preceded by "SSN:" or standalone
  {
    label: 'SSN_LABELED',
    re: /\b(?:SSN|S\.?S\.?N\.?|Social\s+Security(?:\s+Number)?)\s*[:#=]?\s*\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/gi,
    rep: T.SSN,
  },
  {
    label: 'SSN',
    re: /\b\d{3}[-]\d{2}[-]\d{4}\b/g,
    rep: T.SSN,
  },

  // ── Date of Birth (explicit label — before generic date rule) ──────────────
  {
    label: 'DOB_NUMERIC',
    re: /\b(?:d\.?o\.?b\.?|date\s+of\s+birth|birth(?:day|date)?|born(?:\s+on)?)\s*[:#]?\s*(?:0?[1-9]|1[0-2])[\/\-\.](?:0?[1-9]|[12]\d|3[01])[\/\-\.](?:19|20)?\d{2}\b/gi,
    rep: T.DOB,
  },
  {
    label: 'DOB_WORD',
    re: /\b(?:d\.?o\.?b\.?|date\s+of\s+birth|born(?:\s+on)?)\s*[:#]?\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+(?:19|20)\d{2}\b/gi,
    rep: T.DOB,
  },

  // ── Dates (general) ────────────────────────────────────────────────────────
  // MM/DD/YYYY | MM-DD-YYYY | MM.DD.YYYY
  {
    label: 'DATE_MDY',
    re: /\b(?:0?[1-9]|1[0-2])[\/\-\.](?:0?[1-9]|[12]\d|3[01])[\/\-\.](?:19|20)\d{2}\b/g,
    rep: T.DATE,
  },
  // YYYY-MM-DD (ISO)
  {
    label: 'DATE_ISO',
    re: /\b(?:19|20)\d{2}[-\/](?:0?[1-9]|1[0-2])[-\/](?:0?[1-9]|[12]\d|3[01])\b/g,
    rep: T.DATE,
  },
  // Month DD, YYYY
  {
    label: 'DATE_WORD_MDY',
    re: /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+(?:19|20)\d{2}\b/gi,
    rep: T.DATE,
  },
  // DD Month YYYY
  {
    label: 'DATE_WORD_DMY',
    re: /\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?),?\s+(?:19|20)\d{2}\b/gi,
    rep: T.DATE,
  },
  // Short: 01/15/85 or 1/5/85
  {
    label: 'DATE_SHORT',
    re: /\b(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-]\d{2}\b/g,
    rep: T.DATE,
  },

  // ── Phone numbers ───────────────────────────────────────────────────────────
  // Fax labeled (catch before generic phone)
  {
    label: 'FAX',
    re: /\bfax\s*[:#]?\s*(?:\+?1[-.\s]?)?\(?(?:\d{3})\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gi,
    rep: T.FAX,
  },
  // US/Canada: (123) 456-7890 | 123-456-7890 | 123.456.7890 | +1 123 456 7890
  {
    label: 'PHONE',
    re: /(?:\+?1[-.\s]?)?\(?(?:\d{3})\)?[-.\s]?\d{3}[-.\s]?\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,5})?/gi,
    rep: T.PHONE,
  },

  // ── Email ───────────────────────────────────────────────────────────────────
  {
    label: 'EMAIL',
    re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    rep: T.EMAIL,
  },

  // ── URLs ────────────────────────────────────────────────────────────────────
  {
    label: 'URL',
    re: /https?:\/\/[^\s,;)\]'"]+/gi,
    rep: T.URL,
  },

  // ── IP addresses ────────────────────────────────────────────────────────────
  {
    label: 'IP',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    rep: T.IP,
  },

  // ── ZIP codes ───────────────────────────────────────────────────────────────
  // Only match when clearly a zip (preceded by state abbreviation or city, or "zip")
  {
    label: 'ZIP_LABELED',
    re: /\b(?:zip(?:\s+code)?|postal\s+code)\s*[:#]?\s*\d{5}(?:-\d{4})?\b/gi,
    rep: T.ZIP,
  },
  // State + ZIP: CA 90210 or CA, 90210
  {
    label: 'ZIP_STATE',
    re: /\b(?:A[LKSZRAEP]|C[AOT]|D[EC]|F[LM]|G[AU]|HI|I[ADLN]|K[SY]|LA|M[ADEHINOPST]|N[CDEHJMVY]|O[HKR]|P[ARW]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY]),?\s+\d{5}(?:-\d{4})?\b/g,
    rep: (m) => m.replace(/\d{5}(?:-\d{4})?/, T.ZIP),
  },

  // ── Medical Record Numbers ──────────────────────────────────────────────────
  {
    label: 'MRN',
    re: /\b(?:MRN|Medical\s+Record(?:\s+Number|\s+No\.?|\s+#)?|Record(?:\s+Number|\s+No\.?|\s+#)|Patient\s+(?:ID|Number|No\.?|#)|Chart(?:\s+Number|\s+No\.?|\s+#)?)\s*[:#]?\s*[\w\-]{3,}/gi,
    rep: T.MRN,
  },

  // ── NPI ─────────────────────────────────────────────────────────────────────
  {
    label: 'NPI',
    re: /\b(?:NPI|National\s+Provider\s+(?:Identifier|Number|ID))\s*[:#]?\s*\d{10}\b/gi,
    rep: T.NPI,
  },

  // ── Account / Insurance / Policy / Member numbers ───────────────────────────
  {
    label: 'ACCOUNT',
    re: /\b(?:account|acct|insurance|policy|member(?:ship)?|subscriber|beneficiary|claim|group|plan)\s*(?:no\.?|number|num\.?|#|id)?\s*[:#]?\s*[\w\-]{4,}/gi,
    rep: T.ACCOUNT,
  },

  // ── License / DEA / Certificate numbers ─────────────────────────────────────
  {
    label: 'LICENSE',
    re: /\b(?:(?:driver(?:'s)?\s+)?licen[sc]e|DEA|certificate|certification|credential)\s*(?:no\.?|number|num\.?|#)?\s*[:#]?\s*[A-Z0-9][\w\-]{4,}/gi,
    rep: T.LICENSE,
  },
  // Therapy-specific license prefixes (LMFT, LCSW, MFC, LPC, LPCC, LMHC, PSY, etc.)
  {
    label: 'LICENSE_THERAPY',
    re: /\b(?:LMFT|LCSW|MFC|LPC|LPCC|LMHC|PSY|PhD|PsyD|MSW|RN|MD)\s*[:#]?\s*\d[\w\-]{3,}/gi,
    rep: T.LICENSE,
  },

  // ── Credit / debit card numbers ─────────────────────────────────────────────
  {
    label: 'CREDIT_CARD',
    re: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    rep: T.CREDIT,
  },

  // ── Vehicle identifiers (VIN, license plate) ─────────────────────────────────
  {
    label: 'VIN',
    re: /\b(?:VIN|vehicle\s+(?:identification\s+number|id))\s*[:#]?\s*[A-HJ-NPR-Z0-9]{17}\b/gi,
    rep: T.VEHICLE,
  },
  {
    label: 'LICENSE_PLATE',
    re: /\b(?:license\s+plate|plate\s+(?:number|no\.?|#))\s*[:#]?\s*[A-Z0-9]{2,8}\b/gi,
    rep: T.VEHICLE,
  },

  // ── Device identifiers (serial numbers, IMEI, etc.) ──────────────────────────
  {
    label: 'IMEI',
    re: /\b(?:IMEI|serial\s+(?:number|no\.?|#)|device\s+id)\s*[:#]?\s*[\d\-]{10,}/gi,
    rep: T.DEVICE,
  },

  // ── Biometric identifiers ────────────────────────────────────────────────────
  {
    label: 'BIOMETRIC',
    re: /\b(?:fingerprint|retinal|iris|voice\s+print|biometric)\s*(?:scan|id|identifier|data)\b/gi,
    rep: T.BIOMETRIC,
  },

  // ── Street addresses ─────────────────────────────────────────────────────────
  // e.g. "123 Main Street", "456 Oak Ave, Suite 200"
  {
    label: 'ADDRESS',
    re: /\b\d+\s+[A-Z][a-z]+(?:\s+[A-Za-z]+)*\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Square|Sq|Trail|Tr|Terrace|Ter)\b(?:\.?,?\s*(?:Apt|Apartment|Suite|Ste|Unit|Floor|Fl|Bldg|Building|Rm|Room)\.?\s*[\w\-]+)?/gi,
    rep: T.ADDR,
  },

  // ── LAYER 3: Titled names ────────────────────────────────────────────────────
  // Mr./Mrs./Ms./Dr./Prof. + 1-3 capitalized words
  {
    label: 'TITLED_NAME',
    re: /\b(?:Mr\.?|Mrs\.?|Ms\.?|Miss|Mx\.?|Dr\.?|Prof\.?|Rev\.?|Pastor|Rabbi|Imam|Sister|Brother|Officer|Detective|Sergeant|Lieutenant|Captain|Colonel|General|Judge|Attorney)\s+[A-Z][a-z]+(?:[-\s][A-Z][a-z]+){0,2}\b/g,
    rep: T.NAME,
  },

  // ── LAYER 4: Contextual names ─────────────────────────────────────────────────
  // "patient [Name]", "client [Name]", "referred by [Name]", etc.
  {
    label: 'CLINICAL_CONTEXT_NAME',
    re: /\b(?:patient|client|consumer|individual|resident|participant|member|subject|referral?(?:\s+from)?|referred(?:\s+by)?|seen\s+by|therapist|counselor|clinician|supervisor|prescriber|provider|guardian|caregiver|mother|father|parent|spouse|partner|husband|wife|sibling|brother|sister|son|daughter|child(?:ren)?|family\s+member|roommate|employer|teacher)\s+(?:(?:is|was|named?)\s+)?([A-Z][a-z]+(?:[-\s][A-Z][a-z]+)?)\b/g,
    rep: (match, name) => match.slice(0, match.length - name.length) + T.NAME,
  },

  // "Name:" or "Patient Name:" labels
  {
    label: 'NAME_LABEL',
    re: /\b(?:(?:patient|client|full|first|last|middle|legal|preferred|chosen)\s+)?name\s*[:#]\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}/gi,
    rep: (match) => {
      // Keep the label, replace the name part
      const labelEnd = match.search(/[A-Z][a-z]/);
      if (labelEnd === -1) return match;
      return match.slice(0, labelEnd) + T.NAME;
    },
  },

  // Signatures: "- John Smith" or "Signed: John Smith"
  {
    label: 'SIGNATURE',
    re: /(?:signed|signature|written\s+by|submitted\s+by|prepared\s+by|completed\s+by)\s*[:#\-]?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}/gi,
    rep: (match) => {
      const nameMatch = match.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}$/);
      if (!nameMatch) return match;
      return match.slice(0, match.length - nameMatch[0].length) + T.NAME;
    },
  },

  // "First name: John / Last name: Smith"
  {
    label: 'FIRST_LAST_LABELED',
    re: /\b(?:first|last|middle|given|family|surname)\s+name\s*[:#]?\s*[A-Za-z'\-]+/gi,
    rep: (match) => {
      const labelEnd = match.search(/[:#]?\s*[A-Za-z'\-]+$/);
      return match.slice(0, match.search(/[:#]/)) + ': ' + T.NAME;
    },
  },
];

// ── LAYER 5: Common name standalone detection ─────────────────────────────────
// Catches first names that appear without a title or clinical context label.
// Skips: sentence starts, all-caps words (abbreviations), very short words.
function scrubCommonNames(text) {
  return text.replace(/\b([A-Z][a-z]{2,})\b/g, (match, word, offset, str) => {
    if (!COMMON_NAMES.has(word.toLowerCase())) return match;

    // Skip if start of string
    if (offset === 0) return match;

    // Look at what precedes this word (skip whitespace)
    const before = str.slice(0, offset).trimEnd();
    if (before.length === 0) return match;

    const lastChar = before[before.length - 1];

    // Skip if preceded by sentence-ending punctuation (it's the first word of a new sentence)
    // BUT only skip if what follows isn't a second capitalized word (First Last pattern)
    if (/[.!?\n]/.test(lastChar)) {
      // Check if followed by another capitalized word — then it's a full name at sentence start
      const afterMatch = str.slice(offset + match.length).match(/^\s+([A-Z][a-z]+)/);
      if (afterMatch && COMMON_NAMES.has(afterMatch[1].toLowerCase())) {
        return T.NAME; // "John Smith" at sentence start → scrub
      }
      return match; // "John reported..." at sentence start → keep (too risky)
    }

    // Skip if it looks like part of a clinical abbreviation (all-caps context)
    if (/[A-Z\-]$/.test(before.slice(-2))) return match;

    // Skip if preceded by a possessive or article that suggests it's not a name
    if (/\b(?:the|a|an|this|that|these|those|his|her|their|its|our|your|my)\s*$/.test(before)) {
      return match;
    }

    return T.NAME;
  });
}

// ── Full Name pattern (First + Last both common names) ────────────────────────
// High-confidence: both words are in the common names list
function scrubFullNames(text) {
  return text.replace(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g, (match, first, last) => {
    if (COMMON_NAMES.has(first.toLowerCase()) && COMMON_NAMES.has(last.toLowerCase())) {
      return T.NAME;
    }
    return match;
  });
}

// ── Main export: scrub(text) ───────────────────────────────────────────────────
function scrub(text) {
  if (!text || typeof text !== 'string') return { text, redacted: [] };

  let result = text;
  const redacted = [];

  // Apply all regex rules
  for (const rule of RULES) {
    const before = result;
    if (typeof rule.rep === 'function') {
      result = result.replace(rule.re, rule.rep);
    } else {
      result = result.replace(rule.re, rule.rep);
    }
    if (result !== before) redacted.push(rule.label);
  }

  // Apply full name matching (two common names together)
  const beforeFullNames = result;
  result = scrubFullNames(result);
  if (result !== beforeFullNames) redacted.push('FULL_NAME_MATCH');

  // Apply standalone common name detection (Layer 5)
  const beforeCommon = result;
  result = scrubCommonNames(result);
  if (result !== beforeCommon) redacted.push('COMMON_NAME');

  // Collapse multiple consecutive replacement tokens (clean up double-scrubs)
  result = result.replace(/(\[(?:NAME|PHONE|EMAIL|SSN|DATE[^\]]*|ADDRESS|ZIP|MRN|NPI|URL|IP-ADDRESS|ACCOUNT-NUMBER|LICENSE-NUMBER|PAYMENT-INFO|VEHICLE-ID|DEVICE-ID|BIOMETRIC-ID)\])\s*\1/g, '$1');

  return { text: result, redacted };
}

// Convenience: scrub and return just the text (for inline use)
function scrubText(text) {
  return scrub(text).text;
}

// Scrub all string fields recursively in a plain object or array (for req.body)
function scrubObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return scrubText(obj);
  if (Array.isArray(obj)) return obj.map(scrubObject);
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      out[key] = scrubText(val);
    } else if (Array.isArray(val)) {
      out[key] = val.map(scrubObject);
    } else if (val && typeof val === 'object') {
      out[key] = scrubObject(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

module.exports = { scrub, scrubText, scrubObject };
