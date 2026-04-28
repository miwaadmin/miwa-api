'use strict';

const NAME_WORD_RE = /[\p{L}][\p{L}'-]*/gu;

const FILENAME_STOP_WORDS = new Set([
  'assessment',
  'assess',
  'intake',
  'form',
  'forms',
  'full',
  'dmh',
  'client',
  'patient',
  'upload',
  'uploaded',
  'complete',
  'completed',
  'signed',
  'final',
  'copy',
  'pdf',
  'docx',
  'txt',
]);

const NON_NAME_WORDS = new Set([
  ...FILENAME_STOP_WORDS,
  'name',
  'first',
  'last',
  'middle',
  'legal',
  'preferred',
  'dob',
  'date',
  'birth',
  'phone',
  'email',
  'gender',
  'sex',
  'address',
  'guardian',
  'parent',
  'therapist',
  'clinician',
  'provider',
  'emergency',
  'contact',
]);

function cleanString(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripLabelTail(value) {
  return cleanString(value)
    .replace(/\b(?:DOB|Date of Birth|Birth Date|Phone|Mobile|Cell|Email|E-mail|Gender|Sex|Address|MRN|ID)\b\s*[:#-].*$/iu, '')
    .replace(/\b(?:First Name|Last Name|Middle Name|Client Name|Patient Name|Legal Name|Preferred Name)\b\s*[:#-].*$/iu, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[|;].*$/u, '')
    .trim();
}

function titleCaseToken(token) {
  if (!token) return '';
  if (/[a-z]/u.test(token.slice(1))) return token;
  return token.charAt(0).toLocaleUpperCase('en-US') + token.slice(1).toLocaleLowerCase('en-US');
}

function titleCaseName(tokens) {
  return tokens.map((token) => token.split('-').map(titleCaseToken).join('-')).join(' ');
}

function nameTokens(value) {
  return [...cleanString(value).matchAll(NAME_WORD_RE)]
    .map((match) => match[0])
    .filter((token) => !NON_NAME_WORDS.has(token.toLocaleLowerCase('en-US')));
}

function parseNameCandidate(value) {
  const cleaned = stripLabelTail(value);
  if (!cleaned || /\d/u.test(cleaned)) return null;

  const commaParts = cleaned.split(',').map((part) => part.trim()).filter(Boolean);
  const tokens = commaParts.length === 2
    ? [...nameTokens(commaParts[1]), ...nameTokens(commaParts[0])]
    : nameTokens(cleaned);

  if (!tokens.length || tokens.length > 4) return null;
  const displayName = titleCaseName(tokens);
  return {
    firstName: titleCaseName(tokens.slice(0, 1)),
    lastName: tokens.length > 1 ? titleCaseName(tokens.slice(1)) : '',
    displayName,
  };
}

function extractLabeledLine(text, labelPattern, blockedPattern) {
  const lines = String(text || '').split(/\r?\n/u);
  for (const line of lines) {
    if (blockedPattern?.test(line)) continue;
    const match = line.match(labelPattern);
    if (!match?.[1]) continue;
    const value = stripLabelTail(match[1]);
    if (value) return value;
  }
  return '';
}

function extractFirstLast(text) {
  const first = extractLabeledLine(
    text,
    /\b(?:client\s+)?first\s+name\s*[:#-]\s*([^\r\n]+)/iu,
    /\b(?:guardian|parent|emergency|therapist|clinician|provider)\b/iu,
  );
  const last = extractLabeledLine(
    text,
    /\b(?:client\s+)?last\s+name\s*[:#-]\s*([^\r\n]+)/iu,
    /\b(?:guardian|parent|emergency|therapist|clinician|provider)\b/iu,
  );

  const firstToken = nameTokens(first)[0] || '';
  const lastToken = nameTokens(last).join(' ');
  if (!firstToken && !lastToken) return null;

  const parts = [firstToken, lastToken].filter(Boolean);
  return {
    firstName: firstToken ? titleCaseName([firstToken]) : '',
    lastName: lastToken ? titleCaseName(nameTokens(lastToken)) : '',
    displayName: titleCaseName(parts),
  };
}

function extractFullName(text) {
  const value = extractLabeledLine(
    text,
    /\b(?:client|patient|legal|preferred)?\s*name\s*[:#-]\s*([^\r\n]+)/iu,
    /\b(?:guardian|parent|emergency|therapist|clinician|provider|practice)\b/iu,
  );
  return parseNameCandidate(value);
}

function extractEmail(text) {
  const match = String(text || '').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu);
  return match ? match[0] : '';
}

function extractPhone(text) {
  const labeled = (String(text || '').split(/\r?\n/u)
    .map((line) => line.match(/\b(?:phone|mobile|cell|telephone|tel)\s*[:#-]\s*([+()0-9.\-\s]{7,24})/iu)?.[1] || '')
    .find(Boolean)) || '';
  const source = labeled || String(text || '');
  const match = source.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/u);
  return match ? cleanString(match[0]) : '';
}

function extractGender(text) {
  const value = extractLabeledLine(
    text,
    /\b(?:gender|sex)\s*[:#-]\s*([^\r\n]+)/iu,
    /\b(?:sexual\s+orientation|assigned\s+at\s+birth)\b/iu,
  ).toLocaleLowerCase('en-US');

  if (!value) return '';
  if (/\b(?:non[-\s]?binary|nonbinary|genderqueer|gender\s+fluid)\b/u.test(value)) return 'nonbinary';
  if (/\b(?:transgender|trans\s+(?:woman|man|female|male))\b/u.test(value)) return 'transgender';
  if (/\b(?:female|woman|girl|f)\b/u.test(value)) return 'female';
  if (/\b(?:male|man|boy|m)\b/u.test(value)) return 'male';
  return '';
}

function extractNameFromFilename(fileName) {
  const base = cleanString(fileName)
    .replace(/\.[^.]+$/u, '')
    .replace(/[_-]+/gu, ' ');
  const tokens = [...base.matchAll(NAME_WORD_RE)]
    .map((match) => match[0])
    .filter((token) => !FILENAME_STOP_WORDS.has(token.toLocaleLowerCase('en-US')))
    .slice(0, 3);

  if (!tokens.length || tokens.length > 2) return null;
  const displayName = titleCaseName(tokens);
  return {
    firstName: titleCaseName(tokens.slice(0, 1)),
    lastName: tokens.length > 1 ? titleCaseName(tokens.slice(1)) : '',
    displayName,
  };
}

function compactIdentity(identity) {
  const out = {
    firstName: cleanString(identity.firstName),
    lastName: cleanString(identity.lastName),
    displayName: cleanString(identity.displayName),
    phone: cleanString(identity.phone),
    email: cleanString(identity.email),
    gender: cleanString(identity.gender),
  };

  if (!out.displayName) {
    out.displayName = [out.firstName, out.lastName].filter(Boolean).join(' ');
  }

  return out;
}

function extractIntakeIdentity(rawText, fileName = '') {
  const text = String(rawText || '');
  const explicitName = extractFirstLast(text) || extractFullName(text);
  const fallbackName = explicitName?.displayName ? null : extractNameFromFilename(fileName);
  const name = explicitName || fallbackName || {};

  return compactIdentity({
    ...name,
    phone: extractPhone(text),
    email: extractEmail(text),
    gender: extractGender(text),
  });
}

module.exports = {
  extractIntakeIdentity,
};
