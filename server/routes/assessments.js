const express = require('express');
const router = express.Router();
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { emit } = require('../services/event-bus');

// ── Assessment Templates (static definitions) ─────────────────────────────────

// Helper: determine trend direction — reads higherIsBetter from the template definition
function scoreTrend(type, baseline, current) {
  if (baseline === null || current === null) return 'INSUFFICIENT_DATA';
  if (current === baseline) return 'STABLE';
  const template = TEMPLATES[type];
  const higherBetter = template?.higherIsBetter ?? false;
  const improved = higherBetter ? current > baseline : current < baseline;
  return improved ? 'IMPROVING' : 'WORSENING';
}

function clientLabel(patient) {
  return patient?.display_name || patient?.client_id || 'Client';
}

const normalizedTemplateSql = "LOWER(REPLACE(REPLACE(REPLACE(template_type, '-', ''), '_', ''), ' ', ''))";

const TEMPLATES = {
  'phq-9': {
    id: 'phq-9',
    name: 'PHQ-9 Depression Screen',
    description: 'Patient Health Questionnaire-9 for depression screening',
    instructions: 'Over the last 2 weeks, how often have you been bothered by the following problems?',
    timeEstimate: '2-3 minutes',
    copyright: 'Public domain',
    questions: [
      { id: 'phq9_1', text: 'Little interest or pleasure in doing things' },
      { id: 'phq9_2', text: 'Feeling down, depressed, or hopeless' },
      { id: 'phq9_3', text: 'Trouble falling or staying asleep, or sleeping too much' },
      { id: 'phq9_4', text: 'Feeling tired or having little energy' },
      { id: 'phq9_5', text: 'Poor appetite or overeating' },
      { id: 'phq9_6', text: 'Feeling bad about yourself — or that you are a failure or have let yourself or your family down' },
      { id: 'phq9_7', text: 'Trouble concentrating on things, such as reading the newspaper or watching television' },
      { id: 'phq9_8', text: 'Moving or speaking so slowly that other people could have noticed. Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual' },
      { id: 'phq9_9', text: 'Thoughts that you would be better off dead, or of hurting yourself in some way' },
    ],
    options: [
      { value: 0, label: 'Not at all' },
      { value: 1, label: 'Several days' },
      { value: 2, label: 'More than half the days' },
      { value: 3, label: 'Nearly every day' },
    ],
    scoring: {
      min: 0,
      max: 27,
      severityLevels: [
        { min: 0, max: 4, label: 'Minimal', color: '#10B981' },
        { min: 5, max: 9, label: 'Mild', color: '#F59E0B' },
        { min: 10, max: 14, label: 'Moderate', color: '#F97316' },
        { min: 15, max: 19, label: 'Moderately Severe', color: '#EF4444' },
        { min: 20, max: 27, label: 'Severe', color: '#7F1D1D' },
      ],
      clinicalSignificanceThreshold: 5,
    },
    higherIsBetter: false, // higher PHQ-9 = more depression symptoms = worse
    suicideRiskQuestionIndex: 8, // phq9_9 is index 8 (0-based)
  },
  'gad-7': {
    id: 'gad-7',
    name: 'GAD-7 Anxiety Screen',
    description: 'Generalized Anxiety Disorder-7 for anxiety screening',
    instructions: 'Over the last 2 weeks, how often have you been bothered by the following problems?',
    timeEstimate: '2-3 minutes',
    copyright: 'Public domain',
    questions: [
      { id: 'gad7_1', text: 'Feeling nervous, anxious, or on edge' },
      { id: 'gad7_2', text: 'Not being able to stop or control worrying' },
      { id: 'gad7_3', text: 'Worrying too much about different things' },
      { id: 'gad7_4', text: 'Trouble relaxing' },
      { id: 'gad7_5', text: 'Being so restless that it is hard to sit still' },
      { id: 'gad7_6', text: 'Becoming easily annoyed or irritable' },
      { id: 'gad7_7', text: 'Feeling afraid, as if something awful might happen' },
    ],
    options: [
      { value: 0, label: 'Not at all' },
      { value: 1, label: 'Several days' },
      { value: 2, label: 'More than half the days' },
      { value: 3, label: 'Nearly every day' },
    ],
    scoring: {
      min: 0,
      max: 21,
      severityLevels: [
        { min: 0, max: 4, label: 'Minimal', color: '#10B981' },
        { min: 5, max: 9, label: 'Mild', color: '#F59E0B' },
        { min: 10, max: 14, label: 'Moderate', color: '#F97316' },
        { min: 15, max: 21, label: 'Severe', color: '#EF4444' },
      ],
      clinicalSignificanceThreshold: 4,
    },
    higherIsBetter: false, // higher GAD-7 = more anxiety = worse
  },
  'pcl-5': {
    id: 'pcl-5',
    name: 'PCL-5 PTSD Checklist',
    description: 'PTSD Checklist for DSM-5 — 20-item self-report measure of PTSD symptoms',
    instructions: 'In the past month, how much were you bothered by the following problems?',
    timeEstimate: '5-10 minutes',
    copyright: 'Public domain',
    questions: [
      { id: 'pcl5_1',  text: 'Repeated, disturbing, and unwanted memories of the stressful experience?' },
      { id: 'pcl5_2',  text: 'Repeated, disturbing dreams of the stressful experience?' },
      { id: 'pcl5_3',  text: 'Suddenly feeling or acting as if the stressful experience were actually happening again (as if you were actually back there reliving it)?' },
      { id: 'pcl5_4',  text: 'Feeling very upset when something reminded you of the stressful experience?' },
      { id: 'pcl5_5',  text: 'Having strong physical reactions when something reminded you of the stressful experience (heart pounding, trouble breathing, sweating)?' },
      { id: 'pcl5_6',  text: 'Avoiding memories, thoughts, or feelings related to the stressful experience?' },
      { id: 'pcl5_7',  text: 'Avoiding external reminders of the stressful experience (people, places, conversations, activities, objects, or situations)?' },
      { id: 'pcl5_8',  text: 'Trouble remembering important parts of the stressful experience?' },
      { id: 'pcl5_9',  text: 'Having strong negative beliefs about yourself, other people, or the world?' },
      { id: 'pcl5_10', text: 'Blaming yourself or someone else for the stressful experience or what happened after it?' },
      { id: 'pcl5_11', text: 'Having strong negative feelings such as fear, horror, anger, guilt, or shame?' },
      { id: 'pcl5_12', text: 'Loss of interest in activities that you used to enjoy?' },
      { id: 'pcl5_13', text: 'Feeling distant or cut off from other people?' },
      { id: 'pcl5_14', text: 'Trouble experiencing positive feelings (for example, being unable to feel happiness or love for people close to you)?' },
      { id: 'pcl5_15', text: 'Irritable behavior, angry outbursts, or acting aggressively?' },
      { id: 'pcl5_16', text: 'Taking too many risks or doing things that could cause you harm?' },
      { id: 'pcl5_17', text: 'Being "superalert" or watchful or on guard?' },
      { id: 'pcl5_18', text: 'Feeling jumpy or easily startled?' },
      { id: 'pcl5_19', text: 'Having difficulty concentrating?' },
      { id: 'pcl5_20', text: 'Trouble falling or staying asleep?' },
    ],
    options: [
      { value: 0, label: 'Not at all' },
      { value: 1, label: 'A little bit' },
      { value: 2, label: 'Moderately' },
      { value: 3, label: 'Quite a bit' },
      { value: 4, label: 'Extremely' },
    ],
    scoring: {
      min: 0,
      max: 80,
      severityLevels: [
        { min: 0,  max: 31, label: 'Minimal',           color: '#10B981' },
        { min: 32, max: 44, label: 'Moderate',          color: '#F59E0B' },
        { min: 45, max: 59, label: 'Moderately Severe', color: '#F97316' },
        { min: 60, max: 80, label: 'Severe',            color: '#EF4444' },
      ],
      clinicalSignificanceThreshold: 10,
    },
    higherIsBetter: false, // higher PCL-5 = more PTSD symptoms = worse
    provisionalPtsdThreshold: 33,
  },
  'cssrs': {
    id: 'cssrs',
    name: 'C-SSRS Suicide Screener',
    description: 'Columbia Suicide Severity Rating Scale — Screener version (6 yes/no items)',
    instructions: 'Please answer the following questions about your thoughts and feelings over the PAST MONTH.',
    timeEstimate: '2-3 minutes',
    copyright: 'The Research Foundation for Mental Hygiene, Inc.',
    questions: [
      { id: 'cssrs_1', text: 'Have you wished you were dead or wished you could go to sleep and not wake up?' },
      { id: 'cssrs_2', text: 'Have you had any actual thoughts of killing yourself?' },
      { id: 'cssrs_3', text: 'Have you been thinking about how you might do this?' },
      { id: 'cssrs_4', text: 'Have you had these thoughts and had some intention of acting on them?' },
      { id: 'cssrs_5', text: 'Have you started to work out or worked out the details of how to kill yourself? Do you intend to carry out this plan?' },
      { id: 'cssrs_6', text: 'Have you ever done anything, started to do anything, or prepared to do anything to end your life?' },
    ],
    options: [
      { value: 0, label: 'No' },
      { value: 1, label: 'Yes' },
    ],
    scoring: {
      min: 0,
      max: 6,
      severityLevels: [
        { min: 0, max: 0, label: 'No ideation',             color: '#10B981' },
        { min: 1, max: 1, label: 'Passive ideation',        color: '#F59E0B' },
        { min: 2, max: 3, label: 'Active ideation',         color: '#F97316' },
        { min: 4, max: 6, label: 'Active with plan/intent', color: '#EF4444' },
      ],
      clinicalSignificanceThreshold: 1,
    },
    higherIsBetter: false, // higher C-SSRS = more suicidal ideation = worse
    suicideRiskQuestionIndex: 1, // question 2 onward = active ideation = CRITICAL
  },

  // ── Couple / Relationship instruments ─────────────────────────────────────

  'ras': {
    id: 'ras',
    name: 'RAS — Relationship Assessment Scale',
    description: '7-item measure of global relationship satisfaction. Quick check-in for couples.',
    instructions: 'Please answer the following questions about your relationship.',
    timeEstimate: '1-2 minutes',
    copyright: 'Public domain (Hendrick, 1988)',
    clientTypes: ['couple', 'family'],
    questions: [
      { id: 'ras_1', text: 'How well does your partner meet your needs?' },
      { id: 'ras_2', text: 'In general, how satisfied are you with your relationship?' },
      { id: 'ras_3', text: 'How good is your relationship compared to most?' },
      { id: 'ras_4', text: 'How often do you wish you hadn\'t gotten into this relationship?' },
      { id: 'ras_5', text: 'To what extent has your relationship met your original expectations?' },
      { id: 'ras_6', text: 'How much do you love your partner?' },
      { id: 'ras_7', text: 'How many problems are there in your relationship?' },
    ],
    options: [
      { value: 1, label: '1 — Poorly / Not at all' },
      { value: 2, label: '2' },
      { value: 3, label: '3 — Average' },
      { value: 4, label: '4' },
      { value: 5, label: '5 — Extremely well / Completely' },
    ],
    // Items 4 and 7 are reverse-scored (handled client-side display; server uses raw sum)
    reverseItems: ['ras_4', 'ras_7'],
    scoring: {
      min: 7,
      max: 35,
      // Higher = more satisfied. Score ≤28 suggests relationship dissatisfaction.
      severityLevels: [
        { min: 7,  max: 17, label: 'High distress',    color: '#EF4444' },
        { min: 18, max: 22, label: 'Moderate distress', color: '#F97316' },
        { min: 23, max: 27, label: 'Mild concern',      color: '#F59E0B' },
        { min: 28, max: 35, label: 'Satisfied',         color: '#10B981' },
      ],
      clinicalSignificanceThreshold: 3,
    },
    higherIsBetter: true, // higher RAS = greater relationship satisfaction = better
  },

  'das-4': {
    id: 'das-4',
    name: 'DAS-4 — Dyadic Adjustment Scale (Short)',
    description: '4-item ultra-short version of the DAS for tracking couple satisfaction session to session.',
    instructions: 'Please indicate the approximate extent of agreement or disagreement between you and your partner for the following items.',
    timeEstimate: '1 minute',
    copyright: 'Public domain (Spanier, 1976; short form adaptation)',
    clientTypes: ['couple'],
    questions: [
      { id: 'das4_1', text: 'How often do you and your partner agree on handling finances?' },
      { id: 'das4_2', text: 'How often do you and your partner agree on matters of recreation?' },
      { id: 'das4_3', text: 'How often do you and your partner agree on demonstrations of affection?' },
      { id: 'das4_4', text: 'In general, how often do you think things between you and your partner are going well?' },
    ],
    options: [
      { value: 0, label: '0 — Always disagree / Never' },
      { value: 1, label: '1 — Almost always disagree / Rarely' },
      { value: 2, label: '2 — Occasionally disagree / Sometimes' },
      { value: 3, label: '3 — Frequently agree / More often than not' },
      { value: 4, label: '4 — Almost always agree / Frequently' },
      { value: 5, label: '5 — Always agree / All the time' },
    ],
    scoring: {
      min: 0,
      max: 21,
      // Distress cutoff: total ≤11 indicates relationship distress
      severityLevels: [
        { min: 0,  max: 7,  label: 'Significant distress', color: '#EF4444' },
        { min: 8,  max: 11, label: 'Moderate distress',    color: '#F97316' },
        { min: 12, max: 15, label: 'Mild concern',         color: '#F59E0B' },
        { min: 16, max: 21, label: 'Satisfied',            color: '#10B981' },
      ],
      clinicalSignificanceThreshold: 3,
    },
    higherIsBetter: true, // higher DAS-4 = better dyadic adjustment = better
  },

  'score-15': {
    id: 'score-15',
    name: 'SCORE-15 — Family Functioning',
    description: '15-item family outcome measure completed by each family member. Tracks family strengths, difficulties, and communication. Ideal for multi-member tracking.',
    instructions: 'Please read each statement carefully and indicate how much it applies to your family.',
    timeEstimate: '3-5 minutes',
    copyright: 'CORC UK — free for clinical use',
    clientTypes: ['couple', 'family'],
    questions: [
      { id: 'score_1',  text: 'We can talk to each other about the problems we have.' },
      { id: 'score_2',  text: 'We find it hard to make decisions together.' },
      { id: 'score_3',  text: 'We feel close to each other.' },
      { id: 'score_4',  text: 'Arguments in our family get very heated.' },
      { id: 'score_5',  text: 'There is an atmosphere of calm in our family.' },
      { id: 'score_6',  text: 'We tend to listen to each other.' },
      { id: 'score_7',  text: 'We find it hard to cope with everyday life as a family.' },
      { id: 'score_8',  text: 'We care about each other.' },
      { id: 'score_9',  text: 'We are able to resolve conflicts in our family.' },
      { id: 'score_10', text: 'There are significant tensions in our family.' },
      { id: 'score_11', text: 'We support each other.' },
      { id: 'score_12', text: 'We find it difficult to discuss emotional issues.' },
      { id: 'score_13', text: 'Our family life causes us distress.' },
      { id: 'score_14', text: 'We find it difficult to adapt to changes in our family.' },
      { id: 'score_15', text: 'We are able to effectively solve our family problems.' },
    ],
    options: [
      { value: 1, label: '1 — Not at all like our family' },
      { value: 2, label: '2' },
      { value: 3, label: '3 — Somewhat like our family' },
      { value: 4, label: '4' },
      { value: 5, label: '5 — Very much like our family' },
    ],
    // Positive items: 1,3,5,6,8,9,11,15 — reverse-scored: 2,4,7,10,12,13,14
    reverseItems: ['score_2','score_4','score_7','score_10','score_12','score_13','score_14'],
    scoring: {
      min: 15,
      max: 75,
      // Higher = better functioning. Clinical cutoff ~36 for significant difficulty.
      severityLevels: [
        { min: 15, max: 29, label: 'Significant difficulty', color: '#EF4444' },
        { min: 30, max: 42, label: 'Moderate difficulty',    color: '#F97316' },
        { min: 43, max: 54, label: 'Mild difficulty',        color: '#F59E0B' },
        { min: 55, max: 75, label: 'Functioning well',       color: '#10B981' },
      ],
      clinicalSignificanceThreshold: 5,
    },
    higherIsBetter: true, // higher SCORE-15 = better family functioning = better
  },

  'fad-gf': {
    id: 'fad-gf',
    name: 'FAD — General Functioning Scale',
    description: 'McMaster Family Assessment Device — 12-item General Functioning subscale. Assesses overall family health and pathology.',
    instructions: 'Please rate how well each statement describes your family.',
    timeEstimate: '3-4 minutes',
    copyright: 'Epstein, Baldwin & Bishop — free for clinical/research use',
    clientTypes: ['family'],
    questions: [
      { id: 'fad_1',  text: 'Planning family activities is difficult because we misunderstand each other.' },
      { id: 'fad_2',  text: 'In times of crisis we can turn to each other for support.' },
      { id: 'fad_3',  text: 'We cannot talk to each other about the sadness we feel.' },
      { id: 'fad_4',  text: 'Individuals are accepted for what they are.' },
      { id: 'fad_5',  text: 'We avoid discussing our fears and concerns.' },
      { id: 'fad_6',  text: 'We can express feelings to each other.' },
      { id: 'fad_7',  text: 'There are lots of bad feelings in the family.' },
      { id: 'fad_8',  text: 'We feel accepted for what we are.' },
      { id: 'fad_9',  text: 'Making a decision is a problem for our family.' },
      { id: 'fad_10', text: 'We are able to make decisions about how to solve problems.' },
      { id: 'fad_11', text: 'We do not get along well together.' },
      { id: 'fad_12', text: 'We confide in each other.' },
    ],
    options: [
      { value: 1, label: '1 — Strongly agree' },
      { value: 2, label: '2 — Agree' },
      { value: 3, label: '3 — Disagree' },
      { value: 4, label: '4 — Strongly disagree' },
    ],
    // Healthy items (lower score = better): 2,4,6,8,10,12
    // Unhealthy items (higher score = worse): 1,3,5,7,9,11
    // Clinical cutoff: mean ≥2.0 indicates unhealthy family functioning
    reverseItems: ['fad_1','fad_3','fad_5','fad_7','fad_9','fad_11'],
    scoring: {
      min: 12,
      max: 48,
      severityLevels: [
        { min: 12, max: 18, label: 'Healthy functioning',    color: '#10B981' },
        { min: 19, max: 25, label: 'Mild difficulty',        color: '#F59E0B' },
        { min: 26, max: 34, label: 'Moderate difficulty',    color: '#F97316' },
        { min: 35, max: 48, label: 'Significant difficulty', color: '#EF4444' },
      ],
      clinicalSignificanceThreshold: 4,
    },
    higherIsBetter: false, // higher FAD-GF = more family dysfunction = worse
  },
  // ── LAP-MD: Lethality Assessment Program, Maryland Model ──────────────────
  // 11-question intimate partner violence lethality screen. Administered by a
  // clinician or advocate WHILE TALKING with the survivor — not sent via SMS.
  // Scoring is categorical, not a sum:
  //   • Yes to ANY of Q1–Q3 → automatic High-Danger
  //   • Yes to ≥4 of Q4–Q11 → automatic High-Danger
  //   • Otherwise → Not High-Danger (at this time)
  // The clinician can also override to High-Danger based on belief alone.
  'lap-md': {
    id: 'lap-md',
    name: 'Lethality Assessment (LAP-MD)',
    description: 'Maryland Model — 11-question intimate partner violence lethality screen. Based on Dr. Jacquelyn Campbell\'s Danger Assessment, developed by the Maryland Network Against Domestic Violence.',
    instructions: 'Ask each question in order, using the exact wording. Deviating from wording/order invalidates the instrument.',
    timeEstimate: '5-8 minutes',
    copyright: 'Maryland Network Against Domestic Violence (public domain for clinical use)',
    clinicianAdministered: true, // do NOT surface in "send to client" UIs
    questions: [
      { id: 'lap_1',  text: 'Have they ever used a weapon against you or threatened you with a weapon?' },
      { id: 'lap_2',  text: 'Do you think they might try to kill you?' },
      { id: 'lap_3',  text: 'Have they ever tried to choke/strangle you (cut off breathing)?' },
      { id: 'lap_4',  text: 'Have they threatened to kill you or your children?' },
      { id: 'lap_5',  text: 'Do they have a gun, or can they easily get one?' },
      { id: 'lap_6',  text: 'Are they violently or constantly jealous, or do they control most of your daily activities?' },
      { id: 'lap_7',  text: 'Have you left them or separated after living together or being married?' },
      { id: 'lap_8',  text: 'Are they unemployed?' },
      { id: 'lap_9',  text: 'Have they ever tried to kill themselves?' },
      { id: 'lap_10', text: 'Do you have a child/children that they know are not theirs?' },
      { id: 'lap_11', text: 'Do they follow or spy on you, or leave threatening messages?' },
    ],
    options: [
      { value: 1, label: 'Yes' },
      { value: 0, label: 'No' },
      { value: null, label: 'Not answered / Unknown' },
    ],
    // Scoring is categorical — see scoreAssessment() for the LAP-MD branch.
    scoring: {
      min: 0, max: 1,
      severityLevels: [
        { min: 0, max: 0, label: 'Not High-Danger (at this time)', color: '#10B981' },
        { min: 1, max: 1, label: 'High-Danger',                     color: '#DC2626' },
      ],
      clinicalSignificanceThreshold: 1,
    },
    higherIsBetter: false,
  },
};

// ── Scoring helpers ───────────────────────────────────────────────────────────

function scoreAssessment(templateType, responses) {
  const template = TEMPLATES[templateType];
  if (!template) throw new Error('Unknown template type');

  const total = responses.reduce((sum, r) => sum + (r.value || 0), 0);

  // LAP-MD: categorical rule (not a sum)
  //   Yes to ANY of Q1-Q3 → High-Danger
  //   Yes to ≥4 of Q4-Q11 → High-Danger
  //   Otherwise → Not High-Danger (at this time)
  if (templateType === 'lap-md') {
    const yes = responses.map(r => r?.value === 1);
    const yesOnCritical = yes.slice(0, 3).some(Boolean);
    const yesOnOther = yes.slice(3).filter(Boolean).length;
    const highDanger = yesOnCritical || yesOnOther >= 4;
    return {
      total: highDanger ? 1 : 0,
      severityLevel: highDanger ? 'High-Danger' : 'Not High-Danger (at this time)',
      severityColor: highDanger ? '#DC2626' : '#10B981',
    };
  }

  // C-SSRS: severity based on which questions are endorsed
  if (templateType === 'cssrs') {
    const q1 = responses[0]?.value === 1;
    const q2 = responses[1]?.value === 1;
    const q3 = responses[2]?.value === 1;
    const q4 = responses[3]?.value === 1;
    const q5 = responses[4]?.value === 1;
    const q6 = responses[5]?.value === 1;

    let severityLevel, severityColor;
    if (q4 || q5 || q6) {
      severityLevel = 'Active with plan/intent';
      severityColor = '#EF4444';
    } else if (q2 || q3) {
      severityLevel = 'Active ideation';
      severityColor = '#F97316';
    } else if (q1) {
      severityLevel = 'Passive ideation';
      severityColor = '#F59E0B';
    } else {
      severityLevel = 'No ideation';
      severityColor = '#10B981';
    }
    return { total, severityLevel, severityColor };
  }

  const level = template.scoring.severityLevels.find(l => total >= l.min && total <= l.max);

  return {
    total,
    severityLevel: level?.label || 'Unknown',
    severityColor: level?.color || '#6B7280',
  };
}

function generateAlerts(assessment, previous, patient, template) {
  const alerts = [];
  const name = clientLabel(patient);

  // LAP-MD: High-Danger → CRITICAL IPV alert
  if (assessment.template_type === 'lap-md' && assessment.severity_level === 'High-Danger') {
    alerts.push({
      type: 'IPV_LETHALITY_RISK',
      severity: 'CRITICAL',
      title: '🚨 Intimate Partner Lethality Risk',
      description: `${name} screened High-Danger on LAP-MD. Consider DV hotline warm handoff, safety plan review, and protective-order consultation.`,
    });
  }

  // Suicide risk (PHQ-9 q9)
  if (assessment.template_type === 'phq-9') {
    const q9 = JSON.parse(assessment.responses)[8]; // 0-indexed
    if (q9 && q9.value >= 1) {
      alerts.push({
        type: 'SUICIDE_RISK',
        severity: 'CRITICAL',
        title: '⚠️ Suicide Risk Alert',
        description: `${name} endorsed thoughts of self-harm on PHQ-9 item 9 (score: ${q9.value})`,
      });
    }
  }

  // C-SSRS: any yes on questions 2-6 (index 1-5) = CRITICAL
  if (assessment.template_type === 'cssrs') {
    const responses = JSON.parse(assessment.responses);
    const activeIdeation = responses.slice(1).some(r => r && r.value === 1);
    if (activeIdeation) {
      alerts.push({
        type: 'SUICIDE_RISK',
        severity: 'CRITICAL',
        title: '🚨 C-SSRS: Active Suicidal Ideation Detected',
        description: `${name} endorsed active suicidal ideation or behavior on C-SSRS screening. Immediate clinical assessment required.`,
      });
    } else if (responses[0]?.value === 1) {
      alerts.push({
        type: 'SUICIDE_RISK',
        severity: 'WARNING',
        title: '⚠️ C-SSRS: Passive Suicidal Ideation',
        description: `${name} endorsed passive death wish on C-SSRS. Monitor closely.`,
      });
    }
  }

  // PCL-5: note provisional PTSD threshold
  if (assessment.template_type === 'pcl-5') {
    if (assessment.total_score >= 33) {
      alerts.push({
        type: 'PROVISIONAL_PTSD',
        severity: 'WARNING',
        title: 'PCL-5: Provisional PTSD Threshold Reached',
        description: `${name} scored ${assessment.total_score} on PCL-5 (threshold ≥33 indicates provisional PTSD). Clinical assessment recommended.`,
      });
    }
  }

  if (previous) {
    const change = assessment.total_score - previous.total_score;

    // Significant deterioration (≥ 5 point increase)
    if (change >= 5) {
      alerts.push({
        type: 'SIGNIFICANT_DETERIORATION',
        severity: 'WARNING',
        title: 'Significant Symptom Increase',
        description: `${template.name} increased by ${change} points (${previous.total_score} → ${assessment.total_score})`,
      });
    }

    // Significant improvement (≥ 5 point decrease)
    if (change <= -5) {
      alerts.push({
        type: 'SIGNIFICANT_IMPROVEMENT',
        severity: 'SUCCESS',
        title: 'Significant Improvement',
        description: `${template.name} decreased by ${Math.abs(change)} points (${previous.total_score} → ${assessment.total_score})`,
      });
    }

    // Approaching remission (was ≥ 10, now ≤ 9)
    if (previous.total_score >= 10 && assessment.total_score <= 9) {
      alerts.push({
        type: 'APPROACHING_REMISSION',
        severity: 'SUCCESS',
        title: 'Client Approaching Remission',
        description: `${template.name} score now in mild range — significant positive progress`,
      });
    }

    // Severe symptoms
    if (assessment.total_score >= (assessment.template_type === 'phq-9' ? 20 : 15)) {
      alerts.push({
        type: 'SEVERE_SYMPTOMS',
        severity: 'WARNING',
        title: 'Severe Symptom Level',
        description: `${template.name} score of ${assessment.total_score} indicates severe symptoms`,
      });
    }
  }

  return alerts;
}

// ── GET /api/assessments/templates ───────────────────────────────────────────
router.get('/templates', async (req, res) => {
  res.json(Object.values(TEMPLATES));
});

router.get('/templates/:type', async (req, res) => {
  const t = TEMPLATES[req.params.type];
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json(t);
});

// ── GET /api/assessments/overdue ──────────────────────────────────────────────
router.get('/overdue', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;

    const patients = await db.all('SELECT id, client_id, display_name FROM patients WHERE therapist_id = ?', tid);

    const result = [];
    for (const p of patients) {
      const lastPhq9 = await db.get(
        "SELECT MAX(administered_at) as last_at FROM assessments WHERE patient_id = ? AND therapist_id = ? AND LOWER(REPLACE(template_type,'-','')) = 'phq9'",
        p.id, tid
      );
      const lastGad7 = await db.get(
        "SELECT MAX(administered_at) as last_at FROM assessments WHERE patient_id = ? AND therapist_id = ? AND LOWER(REPLACE(template_type,'-','')) = 'gad7'",
        p.id, tid
      );

      const overdueTypes = [];
      let lastDate = null;

      const phq9Date = lastPhq9?.last_at;
      const gad7Date = lastGad7?.last_at;

      if (!phq9Date) {
        overdueTypes.push('phq-9');
      } else {
        const days = (Date.now() - new Date(phq9Date).getTime()) / (1000 * 60 * 60 * 24);
        if (days > 30) overdueTypes.push('phq-9');
      }

      if (!gad7Date) {
        overdueTypes.push('gad-7');
      } else {
        const days = (Date.now() - new Date(gad7Date).getTime()) / (1000 * 60 * 60 * 24);
        if (days > 30) overdueTypes.push('gad-7');
      }

      if (overdueTypes.length > 0) {
        // Most recent assessment of either type
        const dates = [phq9Date, gad7Date].filter(Boolean);
        lastDate = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null;
        const daysOverdue = lastDate
          ? Math.floor((Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24))
          : null;

        result.push({
          patient_id: p.id,
          client_id: p.client_id,
          display_name: p.display_name,
          client_label: clientLabel(p),
          last_assessment_date: lastDate,
          days_overdue: daysOverdue,
          template_types_overdue: overdueTypes,
        });
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/assessments/check-overdue — write overdue alerts to DB ──────────
router.post('/check-overdue', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;

    const patients = await db.all('SELECT id, client_id, display_name FROM patients WHERE therapist_id = ?', tid);
    let written = 0;

    for (const p of patients) {
      const lastAssessment = await db.get(
        "SELECT MAX(administered_at) as last_at FROM assessments WHERE patient_id = ? AND therapist_id = ? AND LOWER(REPLACE(template_type,'-','')) IN ('phq9','gad7')",
        p.id, tid
      );

      const isOverdue = !lastAssessment?.last_at ||
        (Date.now() - new Date(lastAssessment.last_at).getTime()) / (1000 * 60 * 60 * 24) > 30;

      if (!isOverdue) continue;

      // Check if an undismissed ASSESSMENT_OVERDUE alert already exists
      const existing = await db.get(
        "SELECT id FROM progress_alerts WHERE patient_id = ? AND therapist_id = ? AND type = 'ASSESSMENT_OVERDUE' AND dismissed_at IS NULL",
        p.id, tid
      );

      if (!existing) {
        const daysOverdue = lastAssessment?.last_at
          ? Math.floor((Date.now() - new Date(lastAssessment.last_at).getTime()) / (1000 * 60 * 60 * 24))
          : null;
        const desc = daysOverdue
          ? `${clientLabel(p)} has not had a PHQ-9 or GAD-7 in ${daysOverdue} days. Assessment recommended.`
          : `${clientLabel(p)} has never been assessed with PHQ-9 or GAD-7. Baseline assessment recommended.`;

        await db.insert(
          `INSERT INTO progress_alerts (patient_id, therapist_id, type, severity, title, description)
           VALUES (?, ?, 'ASSESSMENT_OVERDUE', 'INFO', 'Assessment Overdue', ?)`,
          p.id, tid, desc
        );
        written++;
      }
    }

    res.json({ ok: true, written });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/assessments/supervision/:patientId ───────────────────────────────
router.get('/supervision/:patientId', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { patientId } = req.params;

    const patient = await db.get('SELECT id FROM patients WHERE id = ? AND therapist_id = ?', patientId, tid);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const notes = await db.all(
      `SELECT osn.*, t.full_name as author_name
       FROM outcome_supervision_notes osn
       LEFT JOIN therapists t ON osn.author_id = t.id
       WHERE osn.patient_id = ? AND osn.therapist_id = ?
       ORDER BY osn.created_at DESC`,
      patientId, tid
    );

    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/assessments/supervision ────────────────────────────────────────
router.post('/supervision', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { patient_id, assessment_id, note_text, note_type } = req.body;

    if (!patient_id || !note_text) {
      return res.status(400).json({ error: 'patient_id and note_text are required' });
    }

    const patient = await db.get('SELECT id FROM patients WHERE id = ? AND therapist_id = ?', patient_id, tid);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const result = await db.insert(
      `INSERT INTO outcome_supervision_notes (patient_id, therapist_id, author_id, assessment_id, note_text, note_type)
       VALUES (?, ?, ?, ?, ?, ?)`,
      patient_id, tid, tid, assessment_id || null, note_text, note_type || 'observation'
    );

    res.json({ id: result.lastInsertRowid, ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/assessments/supervision/:noteId ───────────────────────────────
router.delete('/supervision/:noteId', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;

    await db.run(
      'DELETE FROM outcome_supervision_notes WHERE id = ? AND author_id = ?',
      req.params.noteId, tid
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/assessments/client/:patientId ────────────────────────────────────
router.get('/client/:patientId', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { patientId } = req.params;
    const { type } = req.query;

    // Verify patient belongs to this therapist
    const patient = await db.get('SELECT id FROM patients WHERE id = ? AND therapist_id = ?', patientId, tid);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    let sql = 'SELECT * FROM assessments WHERE patient_id = ? AND therapist_id = ?';
    const params = [patientId, tid];
    if (type) { sql += ' AND template_type = ?'; params.push(type); }
    sql += ' ORDER BY administered_at ASC';

    const rows = await db.all(sql, ...params);
    const parsed = rows.map(r => ({
      ...r,
      responses: JSON.parse(r.responses || '[]'),
      risk_flags: r.risk_flags ? JSON.parse(r.risk_flags) : [],
    }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/assessments — submit a new assessment ───────────────────────────
router.post('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { patient_id, template_type, responses, session_id, notes, member_label } = req.body;

    if (!patient_id || !template_type || !responses) {
      return res.status(400).json({ error: 'patient_id, template_type, and responses are required' });
    }

    const template = TEMPLATES[template_type];
    if (!template) return res.status(400).json({ error: 'Invalid template_type' });

    // Verify patient
    const patient = await db.get('SELECT id, client_id, display_name FROM patients WHERE id = ? AND therapist_id = ?', patient_id, tid);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Score it
    const { total, severityLevel, severityColor } = scoreAssessment(template_type, responses);

    // Get previous assessment for comparison — scoped to same member_label if provided
    const memberFilter = member_label ? ' AND member_label = ?' : ' AND (member_label IS NULL OR member_label = \'\')';
    const memberParams = member_label ? [patient_id, template_type, tid, member_label] : [patient_id, template_type, tid];
    const previous = await db.get(
      `SELECT * FROM assessments WHERE patient_id = ? AND template_type = ? AND therapist_id = ?${memberFilter} ORDER BY administered_at DESC LIMIT 1`,
      ...memberParams
    );

    // Get baseline (first ever assessment for this type + member)
    const baseline = await db.get(
      `SELECT total_score FROM assessments WHERE patient_id = ? AND template_type = ? AND therapist_id = ?${memberFilter} ORDER BY administered_at ASC LIMIT 1`,
      ...memberParams
    );

    const scoreChange = previous ? total - previous.total_score : null;
    const isImprovement = scoreChange !== null && scoreChange <= -template.scoring.clinicalSignificanceThreshold ? 1 : 0;
    const isDeterioration = scoreChange !== null && scoreChange >= template.scoring.clinicalSignificanceThreshold ? 1 : 0;
    const clinicallySignificant = (isImprovement || isDeterioration) ? 1 : 0;

    // Generate risk flags
    const riskFlagsList = [];
    if (template_type === 'phq-9' && responses[8]?.value >= 1) {
      riskFlagsList.push({ type: 'suicide_risk', question: 9, value: responses[8].value });
    }
    if (template_type === 'cssrs') {
      const activeIdeation = responses.slice(1).some(r => r && r.value === 1);
      if (activeIdeation) {
        riskFlagsList.push({ type: 'suicide_risk', source: 'cssrs', active: true });
      } else if (responses[0]?.value === 1) {
        riskFlagsList.push({ type: 'suicide_risk', source: 'cssrs', passive: true });
      }
    }
    if (template_type === 'pcl-5' && total >= 33) {
      riskFlagsList.push({ type: 'provisional_ptsd', score: total });
    }

    // Insert assessment
    const result = await db.insert(
      `INSERT INTO assessments
        (patient_id, therapist_id, template_type, session_id, responses, total_score, severity_level, severity_color,
         baseline_score, previous_score, score_change, is_improvement, is_deterioration, clinically_significant, risk_flags, notes, member_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      patient_id, tid, template_type, session_id || null,
      JSON.stringify(responses), total, severityLevel, severityColor,
      baseline?.total_score ?? total,
      previous?.total_score ?? null,
      scoreChange,
      isImprovement, isDeterioration, clinicallySignificant,
      JSON.stringify(riskFlagsList),
      notes || null,
      member_label || null
    );

    const assessmentId = result.lastInsertRowid;

    // Generate and store alerts
    const mockAssessment = {
      template_type,
      total_score: total,
      responses: JSON.stringify(responses),
    };
    const alerts = generateAlerts(mockAssessment, previous, patient, template);
    for (const alert of alerts) {
      await db.insert(
        `INSERT INTO progress_alerts (patient_id, therapist_id, type, severity, title, description, assessment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        patient_id, tid, alert.type, alert.severity, alert.title, alert.description, assessmentId
      );
    }

    // ── Treatment stagnation detection ─────────────────────────────────────
    // If the last 3+ assessments (same type) all show sub-threshold change,
    // the treatment may be stagnating. Fire a WARNING alert so the clinician
    // knows to review the treatment plan.
    try {
      const recentForStagnation = await db.all(
        `SELECT total_score FROM assessments
         WHERE patient_id = ? AND template_type = ? AND therapist_id = ?
         AND (member_label IS NULL OR member_label = '')
         ORDER BY administered_at DESC LIMIT 4`,
        patient_id, template_type, tid
      );

      if (recentForStagnation.length >= 3) {
        const threshold = template.scoring.clinicalSignificanceThreshold;
        let stagnated = true;
        for (let i = 0; i < recentForStagnation.length - 1 && i < 3; i++) {
          const change = Math.abs(recentForStagnation[i].total_score - recentForStagnation[i + 1].total_score);
          if (change >= threshold) { stagnated = false; break; }
        }

        if (stagnated) {
          const existingStagnation = await db.get(
            `SELECT id FROM progress_alerts
             WHERE patient_id = ? AND therapist_id = ? AND type = 'TREATMENT_STAGNATION'
             AND dismissed_at IS NULL`,
            patient_id, tid
          );

          if (!existingStagnation) {
            const scores = recentForStagnation.slice(0, 3).map(a => a.total_score);
            const scoreRange = `${Math.min(...scores)}–${Math.max(...scores)}`;
            await db.insert(
              `INSERT INTO progress_alerts (patient_id, therapist_id, type, severity, title, description, assessment_id)
               VALUES (?, ?, 'TREATMENT_STAGNATION', 'WARNING', ?, ?, ?)`,
              patient_id, tid,
              'Treatment May Be Stagnating',
              `${clientLabel(patient)}'s ${template.name} scores have plateaued (range: ${scoreRange}) across the last ${recentForStagnation.length} assessments with no reliable change. Consider reviewing the treatment approach, adjusting interventions, or discussing progress with the client.`,
              assessmentId
            );
            alerts.push({
              type: 'TREATMENT_STAGNATION', severity: 'WARNING',
              title: 'Treatment May Be Stagnating',
              description: `${template.name} scores plateaued (${scoreRange}) across last ${recentForStagnation.length} assessments`,
            });
          }
        }
      }
    } catch (stagnationErr) {
      console.error('[assessments] Stagnation check error:', stagnationErr.message);
    }

    // Tier 1 Agentic: emit event for event-bus triggers
    try {
      emit('assessment_submitted', {
        therapist_id: tid,
        patient_id,
        template_type,
        total_score: total,
        severity_level: severityLevel,
        score_change: scoreChange,
        is_improvement: isImprovement,
        is_deterioration: isDeterioration,
      });
    } catch {}

    res.json({
      id: assessmentId,
      total_score: total,
      severity_level: severityLevel,
      severity_color: severityColor,
      score_change: scoreChange,
      is_improvement: isImprovement,
      is_deterioration: isDeterioration,
      alerts_generated: alerts.length,
      risk_flags: riskFlagsList,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/assessments/progress/:patientId ──────────────────────────────────
router.get('/progress/:patientId', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { patientId } = req.params;

    const patient = await db.get('SELECT id, client_id, display_name, client_type, members FROM patients WHERE id = ? AND therapist_id = ?', patientId, tid);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // All assessments for this patient, ordered by date
    const allAssessments = await db.all(
      'SELECT * FROM assessments WHERE patient_id = ? AND therapist_id = ? ORDER BY administered_at ASC',
      patientId, tid
    );

    // Postgres TIMESTAMP columns come back as JS Date objects via node-postgres,
    // but the rest of this endpoint calls .slice(0, 10) and .localeCompare on
    // administered_at as if it were an ISO string (which is what sql.js
    // returned). Without normalization the endpoint throws on every
    // populated patient in production and the chart silently empty-states.
    // Normalize once here so every downstream consumer sees a string.
    for (const a of allAssessments) {
      if (a.administered_at instanceof Date) {
        a.administered_at = a.administered_at.toISOString();
      } else if (a.administered_at != null) {
        a.administered_at = String(a.administered_at);
      }
    }

    // Normalize template_type for comparison (handles uppercase demo data + no-hyphen SMS data)
    const normType = t => (t || '').toLowerCase().replace(/[-_\s]/g, '');
    const typeIs = (a, target) => normType(a.template_type) === normType(target);

    // Legacy individual view: PHQ-9 + GAD-7 + PCL-5 (non-membered)
    const phq9 = allAssessments.filter(a => typeIs(a, 'phq-9') && !a.member_label);
    const gad7 = allAssessments.filter(a => typeIs(a, 'gad-7') && !a.member_label);
    const pcl5 = allAssessments.filter(a => typeIs(a, 'pcl-5') && !a.member_label);

    const buildTimeline = (list, key) => {
      const map = {};
      for (const a of list) {
        const d = a.administered_at.slice(0, 10);
        if (!map[d]) map[d] = { date: d };
        map[d][key] = a.total_score;
        map[d][`${key}_severity`] = a.severity_level;
        map[d][`${key}_id`] = a.id;
      }
      return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
    };

    // Merge phq9 + gad7 timelines
    const timelineMap = {};
    for (const a of phq9) {
      const d = a.administered_at.slice(0, 10);
      if (!timelineMap[d]) timelineMap[d] = { date: d };
      timelineMap[d].phq9 = a.total_score;
      timelineMap[d].phq9_severity = a.severity_level;
      timelineMap[d].phq9_id = a.id;
    }
    for (const a of gad7) {
      const d = a.administered_at.slice(0, 10);
      if (!timelineMap[d]) timelineMap[d] = { date: d };
      timelineMap[d].gad7 = a.total_score;
      timelineMap[d].gad7_severity = a.severity_level;
      timelineMap[d].gad7_id = a.id;
    }
    for (const a of pcl5) {
      const d = a.administered_at.slice(0, 10);
      if (!timelineMap[d]) timelineMap[d] = { date: d };
      timelineMap[d].pcl5 = a.total_score;
      timelineMap[d].pcl5_severity = a.severity_level;
      timelineMap[d].pcl5_id = a.id;
    }
    const timeline = Object.values(timelineMap).sort((a, b) => a.date.localeCompare(b.date));

    // PCL-5 DSM-5 cluster sub-scores from latest assessment
    const pcl5Latest = pcl5[pcl5.length - 1];
    let pcl5Clusters = null;
    if (pcl5Latest?.responses) {
      try {
        const r = JSON.parse(pcl5Latest.responses);
        const sum = (indices) => indices.reduce((s, i) => s + (r[i]?.value || 0), 0);
        pcl5Clusters = {
          B: sum([0,1,2,3,4]),       // Intrusion (items 1-5)
          C: sum([5,6]),             // Avoidance (items 6-7)
          D: sum([7,8,9,10,11,12,13]), // Negative cognitions/mood (items 8-14)
          E: sum([14,15,16,17,18,19]), // Arousal/reactivity (items 15-20)
        };
      } catch {}
    }

    const phq9Latest = phq9[phq9.length - 1];
    const gad7Latest = gad7[gad7.length - 1];

    // ── Multi-member (souls) progress ─────────────────────────────────────────
    // Build per-member, per-template timelines for couple/family clients
    const memberedAssessments = allAssessments.filter(a => a.member_label);
    const byMember = {}; // { "Soul-1": { "phq-9": { timeline, baseline, current, trend } } }

    for (const a of memberedAssessments) {
      const member = a.member_label;
      const type = a.template_type;
      if (!byMember[member]) byMember[member] = {};
      if (!byMember[member][type]) byMember[member][type] = [];
      byMember[member][type].push(a);
    }

    const memberProgress = {};
    for (const [member, types] of Object.entries(byMember)) {
      memberProgress[member] = {};
      for (const [type, list] of Object.entries(types)) {
        const sorted = list.sort((a, b) => a.administered_at.localeCompare(b.administered_at));
        const latest = sorted[sorted.length - 1];
        const timelineData = buildTimeline(sorted, 'score');
        memberProgress[member][type] = {
          timeline: timelineData,
          baseline: sorted[0]?.total_score ?? null,
          current: latest?.total_score ?? null,
          severity: latest?.severity_level ?? null,
          color: latest?.severity_color ?? null,
          count: sorted.length,
          trend: sorted.length >= 2
            ? scoreTrend(type, sorted[0].total_score, latest.total_score)
            : 'INSUFFICIENT_DATA',
        };
      }
    }

    res.json({
      patient_id: patientId,
      client_id: patient.client_id,
      display_name: patient.display_name,
      client_label: clientLabel(patient),
      client_type: patient.client_type || 'individual',
      timeline,
      phq9: {
        baseline: phq9[0]?.total_score ?? null,
        current: phq9Latest?.total_score ?? null,
        severity: phq9Latest?.severity_level ?? null,
        color: phq9Latest?.severity_color ?? null,
        count: phq9.length,
        trend: phq9.length >= 2
          ? scoreTrend('phq-9', phq9[0].total_score, phq9Latest.total_score)
          : 'INSUFFICIENT_DATA',
      },
      gad7: {
        baseline: gad7[0]?.total_score ?? null,
        current: gad7Latest?.total_score ?? null,
        severity: gad7Latest?.severity_level ?? null,
        color: gad7Latest?.severity_color ?? null,
        count: gad7.length,
        trend: gad7.length >= 2
          ? scoreTrend('gad-7', gad7[0].total_score, gad7Latest.total_score)
          : 'INSUFFICIENT_DATA',
      },
      pcl5: {
        baseline: pcl5[0]?.total_score ?? null,
        current: pcl5Latest?.total_score ?? null,
        severity: pcl5Latest?.severity_level ?? null,
        color: pcl5Latest?.severity_color ?? null,
        count: pcl5.length,
        provisionalPtsd: pcl5Latest ? pcl5Latest.total_score >= 33 : false,
        clusters: pcl5Clusters,
        trend: pcl5.length >= 2
          ? scoreTrend('pcl-5', pcl5[0].total_score, pcl5Latest.total_score)
          : 'INSUFFICIENT_DATA',
      },
      totalAssessments: allAssessments.length,
      byMember: memberProgress, // { "Soul-1": { "phq-9": {...}, "ras": {...} } }
    });
  } catch (err) {
    // Surface the actual error so the Outcomes page and the PatientDetail
    // chart stop silently failing. Same diagnostic pattern we used for
    // /patients/alerts — log to Azure App Service logs AND return the
    // message in the body so we can read it from the browser network panel.
    console.error('[assessments/progress] failed:', err);
    res.status(500).json({
      error: 'Failed to compute progress',
      detail: err?.message || String(err),
      code: err?.code || null,
    });
  }
});

// ── GET /api/assessments/alerts — all unread alerts for this therapist ─────────
router.get('/alerts', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;

    const alerts = await db.all(
      `SELECT pa.id, pa.therapist_id, pa.patient_id, pa.alert_type, pa.severity,
              pa.title, pa.description, pa.dismissed_at, pa.created_at,
              p.client_id, p.display_name
       FROM progress_alerts pa
       JOIN patients p ON pa.patient_id = p.id
       WHERE pa.therapist_id = ? AND pa.dismissed_at IS NULL
       ORDER BY pa.created_at DESC
       LIMIT 100`,
      tid
    );

    res.json(alerts.map(a => ({
      ...a,
      description: a.display_name && a.client_id
        ? String(a.description || '').replaceAll(a.client_id, a.display_name)
        : a.description,
      client_label: clientLabel(a),
    })));
  } catch (err) {
    console.error('[assessments/alerts] failed:', err);
    res.status(500).json({
      error: 'Failed to load alerts',
      detail: err?.message || String(err),
      code: err?.code || null,
    });
  }
});

// ── PATCH /api/assessments/alerts/:id/read ────────────────────────────────────
router.patch('/alerts/:id/read', async (req, res) => {
  try {
    const db = getAsyncDb();
    await db.run(
      'UPDATE progress_alerts SET is_read = 1 WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/assessments/alerts/:id ───────────────────────────────────────
router.delete('/alerts/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    await db.run(
      'UPDATE progress_alerts SET dismissed_at = CURRENT_TIMESTAMP WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/assessments/caseload — per-patient risk overview ─────────────────
router.get('/caseload', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;

    const patients = await db.all('SELECT id, client_id, display_name FROM patients WHERE therapist_id = ?', tid);

    const result = [];
    for (const p of patients) {
      const phq9 = await db.get(
        `SELECT total_score, severity_level, severity_color, administered_at
         FROM assessments
         WHERE patient_id = ? AND therapist_id = ? AND ${normalizedTemplateSql} = 'phq9'
         ORDER BY administered_at DESC LIMIT 1`,
        p.id, tid
      );
      const gad7 = await db.get(
        `SELECT total_score, severity_level, severity_color, administered_at
         FROM assessments
         WHERE patient_id = ? AND therapist_id = ? AND ${normalizedTemplateSql} = 'gad7'
         ORDER BY administered_at DESC LIMIT 1`,
        p.id, tid
      );
      const criticalAlert = await db.get(
        "SELECT id FROM progress_alerts WHERE patient_id = ? AND therapist_id = ? AND severity = 'CRITICAL' AND dismissed_at IS NULL LIMIT 1",
        p.id, tid
      );
      const lastAssessed = phq9?.administered_at || gad7?.administered_at;
      const daysSince = lastAssessed
        ? Math.floor((Date.now() - new Date(lastAssessed).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      result.push({
        patient_id: p.id,
        client_id: p.client_id,
        display_name: p.display_name,
        client_label: clientLabel(p),
        phq9_latest: phq9?.total_score ?? null,
        phq9_severity: phq9?.severity_level ?? null,
        phq9_color: phq9?.severity_color ?? null,
        gad7_latest: gad7?.total_score ?? null,
        gad7_severity: gad7?.severity_level ?? null,
        gad7_color: gad7?.severity_color ?? null,
        has_critical_alert: !!criticalAlert,
        last_assessed: lastAssessed || null,
        days_since_assessment: daysSince,
        never_assessed: !phq9 && !gad7,
      });
    }

    // Sort: critical first, then by PHQ-9 score desc, then never assessed
    result.sort((a, b) => {
      if (a.has_critical_alert && !b.has_critical_alert) return -1;
      if (!a.has_critical_alert && b.has_critical_alert) return 1;
      if (a.never_assessed && !b.never_assessed) return 1;
      if (!a.never_assessed && b.never_assessed) return -1;
      return (b.phq9_latest ?? 0) - (a.phq9_latest ?? 0);
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/assessments/practice — practice-level overview ──────────────────
router.get('/practice', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;

    const totalAssessments = (await db.get(
      'SELECT COUNT(*) as count FROM assessments WHERE therapist_id = ?', tid
    )).count;

    const activeClients = (await db.get(
      'SELECT COUNT(DISTINCT patient_id) as count FROM assessments WHERE therapist_id = ?', tid
    )).count;

    const criticalAlerts = (await db.get(
      "SELECT COUNT(*) as count FROM progress_alerts WHERE therapist_id = ? AND severity = 'CRITICAL' AND dismissed_at IS NULL",
      tid
    )).count;

    const unreadAlerts = (await db.get(
      'SELECT COUNT(*) as count FROM progress_alerts WHERE therapist_id = ? AND is_read = 0 AND dismissed_at IS NULL',
      tid
    )).count;

    // PHQ-9 avg current scores per patient
    const phq9Stats = await db.all(
      `SELECT a.patient_id, a.administered_at as latest_date, a.total_score
       FROM assessments a
       WHERE a.therapist_id = ? AND ${normalizedTemplateSql.replaceAll('template_type', 'a.template_type')} = 'phq9'
       AND a.administered_at = (
         SELECT MAX(a2.administered_at)
         FROM assessments a2
         WHERE a2.patient_id = a.patient_id
           AND a2.therapist_id = a.therapist_id
           AND ${normalizedTemplateSql.replaceAll('template_type', 'a2.template_type')} = 'phq9'
       )`,
      tid
    );

    const gad7Stats = await db.all(
      `SELECT a.patient_id, a.administered_at as latest_date, a.total_score
       FROM assessments a
       WHERE a.therapist_id = ? AND ${normalizedTemplateSql.replaceAll('template_type', 'a.template_type')} = 'gad7'
       AND a.administered_at = (
         SELECT MAX(a2.administered_at)
         FROM assessments a2
         WHERE a2.patient_id = a.patient_id
           AND a2.therapist_id = a.therapist_id
           AND ${normalizedTemplateSql.replaceAll('template_type', 'a2.template_type')} = 'gad7'
       )`,
      tid
    );

    const avgPhq9 = phq9Stats.length
      ? Math.round(phq9Stats.reduce((s, r) => s + r.total_score, 0) / phq9Stats.length)
      : null;
    const avgGad7 = gad7Stats.length
      ? Math.round(gad7Stats.reduce((s, r) => s + r.total_score, 0) / gad7Stats.length)
      : null;

    // Severity distribution for PHQ-9
    const phq9Distribution = { Minimal: 0, Mild: 0, Moderate: 0, 'Moderately Severe': 0, Severe: 0 };
    for (const r of phq9Stats) {
      if (r.total_score <= 4) phq9Distribution['Minimal']++;
      else if (r.total_score <= 9) phq9Distribution['Mild']++;
      else if (r.total_score <= 14) phq9Distribution['Moderate']++;
      else if (r.total_score <= 19) phq9Distribution['Moderately Severe']++;
      else phq9Distribution['Severe']++;
    }

    // Recent improvements
    const improvements = (await db.get(
      "SELECT COUNT(*) as count FROM assessments WHERE therapist_id = ? AND is_improvement = 1", tid
    )).count;

    // ── Treatment response tracker ──────────────────────────────────────────
    // Non-responders: patients with 4+ PHQ-9 assessments, <20% improvement
    const allPatientPhq9 = await db.all(
      `SELECT patient_id,
              COUNT(*) as assessments_count,
              MIN(total_score) as baseline_score_min,
              MAX(administered_at) as latest_date
       FROM assessments
       WHERE therapist_id = ? AND template_type = 'phq-9'
       GROUP BY patient_id
       HAVING COUNT(*) >= 4`,
      tid
    );

    const nonResponders = [];
    for (const row of allPatientPhq9) {
      const firstAssessment = await db.get(
        "SELECT total_score FROM assessments WHERE patient_id = ? AND therapist_id = ? AND template_type = 'phq-9' ORDER BY administered_at ASC LIMIT 1",
        row.patient_id, tid
      );
      const latestAssessment = await db.get(
        "SELECT total_score FROM assessments WHERE patient_id = ? AND therapist_id = ? AND template_type = 'phq-9' ORDER BY administered_at DESC LIMIT 1",
        row.patient_id, tid
      );
      const patientInfo = await db.get('SELECT client_id, display_name FROM patients WHERE id = ?', row.patient_id);

      if (!firstAssessment || !latestAssessment) continue;

      const baseline = firstAssessment.total_score;
      const latest = latestAssessment.total_score;
      const percentChange = baseline > 0 ? ((latest - baseline) / baseline) * 100 : 0;

      // Less than 20% improvement (or worsening)
      if (percentChange > -20) {
        nonResponders.push({
          patient_id: row.patient_id,
          client_id: patientInfo?.client_id || `Patient ${row.patient_id}`,
          display_name: patientInfo?.display_name || null,
          client_label: clientLabel(patientInfo),
          assessments_count: row.assessments_count,
          latest_score: latest,
          baseline_score: baseline,
          percent_change: Math.round(percentChange),
        });
      }
    }

    // Sessions to remission: patients who achieved PHQ-9 ≤ 9 from baseline ≥ 10
    const sessionsToRemissionData = [];
    const patientsForRemission = await db.all(
      `SELECT DISTINCT patient_id FROM assessments WHERE therapist_id = ? AND template_type = 'phq-9'`,
      tid
    );

    for (const row of patientsForRemission) {
      const allPhq9 = await db.all(
        "SELECT total_score, administered_at FROM assessments WHERE patient_id = ? AND therapist_id = ? AND template_type = 'phq-9' ORDER BY administered_at ASC",
        row.patient_id, tid
      );
      if (allPhq9.length < 2) continue;
      if (allPhq9[0].total_score < 10) continue; // baseline must be >= 10

      // Find when they first reached remission (score <= 9)
      for (let i = 1; i < allPhq9.length; i++) {
        if (allPhq9[i].total_score <= 9) {
          // Count sessions between baseline and remission date
          const remissionDate = allPhq9[i].administered_at;
          const baselineDate = allPhq9[0].administered_at;
          const sessionCount = await db.get(
            `SELECT COUNT(*) as count FROM sessions
             WHERE patient_id = ? AND therapist_id = ?
             AND created_at BETWEEN ? AND ?`,
            row.patient_id, tid, baselineDate, remissionDate
          );
          sessionsToRemissionData.push(sessionCount?.count || 0);
          break;
        }
      }
    }

    const avgSessionsToRemission = sessionsToRemissionData.length > 0
      ? Math.round(sessionsToRemissionData.reduce((a, b) => a + b, 0) / sessionsToRemissionData.length)
      : null;

    // Remission rate: percentage of patients who achieved PHQ-9 ≤ 9 from baseline ≥ 10
    const eligibleForRemission = [];
    for (const row of patientsForRemission) {
      const first = await db.get(
        "SELECT total_score FROM assessments WHERE patient_id = ? AND therapist_id = ? AND template_type = 'phq-9' ORDER BY administered_at ASC LIMIT 1",
        row.patient_id, tid
      );
      if (first && first.total_score >= 10) eligibleForRemission.push(row);
    }

    const achievedRemission = [];
    for (const row of eligibleForRemission) {
      const assessments = await db.all(
        "SELECT total_score FROM assessments WHERE patient_id = ? AND therapist_id = ? AND template_type = 'phq-9' ORDER BY administered_at ASC",
        row.patient_id, tid
      );
      if (assessments.slice(1).some(a => a.total_score <= 9)) achievedRemission.push(row);
    }

    const remissionRate = eligibleForRemission.length > 0
      ? Math.round((achievedRemission.length / eligibleForRemission.length) * 100)
      : null;

    res.json({
      totalAssessments,
      activeClients,
      criticalAlerts,
      unreadAlerts,
      avgPhq9,
      avgGad7,
      phq9Distribution,
      improvements,
      phq9Count: phq9Stats.length,
      gad7Count: gad7Stats.length,
      nonResponders,
      avgSessionsToRemission,
      remissionRate,
    });
  } catch (err) {
    console.error('[assessments/practice] failed:', err);
    res.status(500).json({
      error: 'Failed to load practice overview',
      detail: err?.message || String(err),
      code: err?.code || null,
    });
  }
});

// ── POST /api/assessments/links — therapist generates a client assessment link ──
router.post('/links', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid    = req.therapist.id;
    const { patient_id, template_type, member_label, expires_days = 7 } = req.body;

    if (!patient_id || !template_type) {
      return res.status(400).json({ error: 'patient_id and template_type are required' });
    }
    if (!TEMPLATES[template_type]) {
      return res.status(400).json({ error: 'Invalid template_type' });
    }

    const patient = await db.get('SELECT id, client_id, display_name FROM patients WHERE id = ? AND therapist_id = ?', patient_id, tid);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Crypto-random 32-byte hex token
    const { randomBytes } = require('crypto');
    const token = randomBytes(32).toString('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Math.min(Math.max(parseInt(expires_days) || 7, 1), 30));

    await db.insert(
      `INSERT INTO assessment_links
         (token, patient_id, therapist_id, template_type, member_label, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      token, patient_id, tid, template_type,
      member_label || null,
      expiresAt.toISOString(),
    );

    const appUrl = process.env.APP_URL || 'https://miwa.care';
    res.json({
      token,
      url: `${appUrl}/assess/${token}`,
      template_type,
      template_name: TEMPLATES[template_type].name,
      expires_at: expiresAt.toISOString(),
      client_id: patient.client_id,
      display_name: patient.display_name,
      client_label: clientLabel(patient),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/assessments/links — list active links for a patient ──────────────
router.get('/links', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { patient_id } = req.query;

    let sql = `SELECT al.*, p.client_id FROM assessment_links al
               JOIN patients p ON al.patient_id = p.id
               WHERE al.therapist_id = ?`;
    const params = [tid];
    if (patient_id) { sql += ' AND al.patient_id = ?'; params.push(patient_id); }
    sql += ' ORDER BY al.created_at DESC LIMIT 50';

    const links = await db.all(sql, ...params);
    res.json(links);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/assessments/links/:token — revoke a link ─────────────────────
router.delete('/links/:token', async (req, res) => {
  try {
    const db = getAsyncDb();
    await db.run(
      'DELETE FROM assessment_links WHERE token = ? AND therapist_id = ?',
      req.params.token, req.therapist.id,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Between-Session Check-ins ─────────────────────────────────────────────────

const { randomBytes } = require('crypto');


// POST /api/assessments/checkin — create a check-in link and optionally SMS it now
router.post('/checkin', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { patient_id, message, send_now = true, expires_days = 3 } = req.body;

    if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });

    const patient = await db.get('SELECT id, client_id, display_name, phone FROM patients WHERE id = ? AND therapist_id = ?', patient_id, tid);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + Math.min(Math.max(parseInt(expires_days) || 3, 1), 14) * 86400000);
    const defaultMessage = `Hi, your therapist is checking in. How have you been feeling since your last session? Click the link to share a quick update.`;
    const checkinMessage = (message || defaultMessage).trim();

    await db.insert(
      `INSERT INTO checkin_links (token, patient_id, therapist_id, message, expires_at) VALUES (?, ?, ?, ?, ?)`,
      token, patient_id, tid, checkinMessage, expiresAt.toISOString()
    );

    const appUrl = (process.env.APP_BASE_URL || process.env.APP_URL || 'https://miwa.care').replace(/\/$/, '');
    const checkinUrl = `${appUrl}/checkin/${token}`;

    // Auto-send via preferred contact method
    let smsSent = false;
    let emailSent = false;
    const patientFull = await db.get('SELECT phone, email, preferred_contact_method, sms_consent FROM patients WHERE id = ?', patient_id);
    const preferredMethod = patientFull?.preferred_contact_method || 'sms';

    if (send_now) {
      // Try SMS — requires recorded SMS consent
      if (patientFull?.phone && patientFull?.sms_consent && (preferredMethod === 'sms' || preferredMethod === 'ask')) {
        try {
          const { sendAssessmentSms } = require('../services/twilio');
          // sendAssessmentSms appends STOP/HELP language; pass the bare message + link
          const smsText = `${checkinMessage}\n\n${checkinUrl}`;
          await sendAssessmentSms(patientFull.phone, token, 'checkin', smsText);
          await db.run('UPDATE checkin_links SET sent_at = CURRENT_TIMESTAMP WHERE token = ?', token);
          smsSent = true;
        } catch (smsErr) {
          console.error('[checkin] SMS send error:', smsErr.message);
        }
      }
      // Try email (if SMS didn't send, or if preferred method is email)
      if (!smsSent && patientFull?.email && (preferredMethod === 'email' || preferredMethod === 'ask')) {
        try {
          const { sendMail } = require('../services/mailer');
          await sendMail({
            to: patientFull.email,
            subject: 'Check-in from your therapist',
            text: `${checkinMessage}\n\n${checkinUrl}`,
            html: `<p>${checkinMessage}</p><p><a href="${checkinUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#5746ed,#0ac5a2);color:white;border-radius:12px;text-decoration:none;font-weight:700;">Complete Check-in</a></p>`,
          });
          await db.run('UPDATE checkin_links SET sent_at = CURRENT_TIMESTAMP WHERE token = ?', token);
          emailSent = true;
        } catch (emailErr) {
          console.error('[checkin] Email send error:', emailErr.message);
        }
      }
    }

    await persistIfNeeded();

    res.json({
      token,
      url: checkinUrl,
      expires_at: expiresAt.toISOString(),
      sms_sent: smsSent,
      client_id: patient.client_id,
      display_name: patient.display_name,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/assessments/checkin?patient_id=X — list check-ins for a patient
router.get('/checkin', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { patient_id } = req.query;

    let sql = `SELECT cl.*, p.client_id, p.display_name
               FROM checkin_links cl JOIN patients p ON cl.patient_id = p.id
               WHERE cl.therapist_id = ?`;
    const params = [tid];
    if (patient_id) { sql += ' AND cl.patient_id = ?'; params.push(patient_id); }
    sql += ' ORDER BY cl.created_at DESC LIMIT 30';

    res.json((await db.all(sql, ...params)) || []);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Assessment Delivery ──────────────────────────────────────────────────────

// POST /api/assessments/send — send assessment using preferred contact method
router.post('/send', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { patient_id, template_type, send_now = true, custom_message, method } = req.body;

    if (!patient_id || !template_type) {
      return res.status(400).json({ error: 'patient_id and template_type are required' });
    }

    // Get patient and verify ownership
    const patient = await db.get(
      'SELECT id, client_id, display_name, email, phone, preferred_contact_method, sms_consent FROM patients WHERE id = ? AND therapist_id = ?',
      patient_id, tid
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Verify template exists
    if (!TEMPLATES[template_type]) {
      return res.status(400).json({ error: 'Invalid template_type' });
    }

    // Determine how to send based on preferred method or override
    let sendMethod = method || patient.preferred_contact_method || 'sms';

    // If preferred is 'ask', return both options for clinician to choose
    if (sendMethod === 'ask') {
      return res.json({
        ask: true,
        hasSms: !!patient.phone,
        hasEmail: !!patient.email,
        message: 'Choose how to send the assessment:'
      });
    }

    // Create assessment link
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.insert(
      `INSERT INTO assessment_links
         (token, patient_id, therapist_id, template_type, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      token, patient_id, tid, template_type, expiresAt.toISOString()
    );

    const appUrl = (process.env.APP_BASE_URL || process.env.APP_URL || 'https://miwa.care').replace(/\/$/, '');
    const assessmentUrl = `${appUrl}/assess/${token}`;
    const templateName = TEMPLATES[template_type]?.name || template_type;

    // Send via chosen method
    let sent = false;
    let sentVia = null;

    if (sendMethod === 'email' && send_now && patient.email) {
      try {
        const { sendAssessmentEmail } = require('../services/mailer');
        await sendAssessmentEmail({
          toEmail: patient.email,
          token,
          type: templateName,
          clientName: patient.display_name,
          customMsg: custom_message,
        });
        await db.run('UPDATE assessment_links SET sent_at = CURRENT_TIMESTAMP WHERE token = ?', token);
        sent = true;
        sentVia = 'email';
      } catch (emailErr) {
        console.error('[assessment] Email send error:', emailErr.message);
      }
    } else if (sendMethod === 'sms' && send_now && patient.phone && patient.sms_consent) {
      try {
        const { sendAssessmentSms } = require('../services/twilio');
        const smsText = custom_message
          ? `${custom_message}\n\n${assessmentUrl}`
          : `Your therapist sent you a ${templateName}. Complete it here: ${assessmentUrl}`;
        await sendAssessmentSms(patient.phone, token, template_type, smsText);
        await db.run('UPDATE assessment_links SET sent_at = CURRENT_TIMESTAMP WHERE token = ?', token);
        sent = true;
        sentVia = 'sms';
      } catch (smsErr) {
        console.error('[assessment] SMS send error:', smsErr.message);
      }
    }

    await persistIfNeeded();

    res.json({
      token,
      url: assessmentUrl,
      expires_at: expiresAt.toISOString(),
      sent,
      sent_via: sentVia,
      client_id: patient.client_id,
      display_name: patient.display_name,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/assessments/send-email — send assessment link via email (direct)
router.post('/send-email', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { patient_id, template_type, send_now = true, custom_message } = req.body;

    if (!patient_id || !template_type) {
      return res.status(400).json({ error: 'patient_id and template_type are required' });
    }

    // Get patient and verify ownership
    const patient = await db.get(
      'SELECT id, client_id, display_name, email FROM patients WHERE id = ? AND therapist_id = ?',
      patient_id, tid
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Verify template exists
    if (!TEMPLATES[template_type]) {
      return res.status(400).json({ error: 'Invalid template_type' });
    }

    // Create assessment link
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.insert(
      `INSERT INTO assessment_links
         (token, patient_id, therapist_id, template_type, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      token, patient_id, tid, template_type, expiresAt.toISOString()
    );

    const appUrl = (process.env.APP_BASE_URL || process.env.APP_URL || 'https://miwa.care').replace(/\/$/, '');
    const assessmentUrl = `${appUrl}/assess/${token}`;

    // Send email now if patient has an email address
    let emailSent = false;
    if (send_now && patient.email) {
      try {
        const { sendAssessmentEmail } = require('../services/mailer');
        const templateName = TEMPLATES[template_type]?.name || template_type;

        await sendAssessmentEmail({
          toEmail: patient.email,
          token,
          type: templateName,
          clientName: patient.display_name,
          customMsg: custom_message,
        });

        await db.run('UPDATE assessment_links SET sent_at = CURRENT_TIMESTAMP WHERE token = ?', token);
        emailSent = true;
      } catch (emailErr) {
        console.error('[assessment] Email send error:', emailErr.message);
      }
    }

    await persistIfNeeded();

    res.json({
      token,
      url: assessmentUrl,
      expires_at: expiresAt.toISOString(),
      email_sent: emailSent,
      client_id: patient.client_id,
      display_name: patient.display_name,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/assessments/mbc-adherence ─────────────────────────────────────
// MBC adherence rate: what % of signed sessions have a matching PHQ-9 or
// GAD-7 assessment within ±3 days? This is the single most important metric
// from the Two Chairs MBC study (they achieved 96%).
router.get('/mbc-adherence', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;

    const totalSessions = (await db.get(
      'SELECT COUNT(*) as c FROM sessions WHERE therapist_id = ? AND signed_at IS NOT NULL',
      tid
    ))?.c || 0;

    // Count distinct sessions that have at least one PHQ-9 or GAD-7 within ±3 days
    const sessionsWithMbc = (await db.get(
      `SELECT COUNT(DISTINCT s.id) as c
       FROM sessions s
       WHERE s.therapist_id = ? AND s.signed_at IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM assessments a
         WHERE a.patient_id = s.patient_id AND a.therapist_id = s.therapist_id
         AND LOWER(a.template_type) IN ('phq9', 'phq-9', 'gad7', 'gad-7')
         AND ABS(JULIANDAY(a.administered_at) - JULIANDAY(COALESCE(s.session_date, s.created_at))) <= 3
       )`,
      tid
    ))?.c || 0;

    const adherenceRate = totalSessions > 0 ? Math.round((sessionsWithMbc / totalSessions) * 100) : null;

    res.json({
      adherence_rate: adherenceRate,
      sessions_with_mbc: sessionsWithMbc,
      total_sessions: totalSessions,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
// Export engine functions so public.js can reuse scoring logic without duplication
module.exports.TEMPLATES         = TEMPLATES;
module.exports.scoreAssessment   = scoreAssessment;
module.exports.generateAlerts    = generateAlerts;
