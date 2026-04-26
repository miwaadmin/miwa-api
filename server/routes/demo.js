/**
 * Demo Patient Generator
 * POST /api/seed/demo-patient
 *
 * Creates a fully realised synthetic client complete with:
 *   - Intake fields, diagnoses, risk screening, treatment goals
 *   - 4-8 SOAP/BIRP/DAP session notes
 *   - PHQ-9 + GAD-7 outcome trajectories
 *   - Realistic progress alerts
 *
 * All data is fictional. No PHI is used.
 */

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { getDb, persist } = require('../db');

// ── Utilities ────────────────────────────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function uid() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

function dateOffsetDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Convert a (date, local-hour, tz) triple to a UTC ISO timestamp that, when
// displayed in `tz`, lands on exactly the hour we asked for. Used for demo
// appointments so they show up at sensible clinical hours instead of UTC-3am
// for the therapist viewing them.
function localTimeToUtcIso(dateStr, localHour, localMinute, tz) {
  // Naive UTC interpretation of the requested wall-clock time
  const hh = String(localHour).padStart(2, '0');
  const mm = String(localMinute).padStart(2, '0');
  const naive = new Date(`${dateStr}T${hh}:${mm}:00Z`);
  // What does that instant look like in the target TZ?
  const formatted = naive.toLocaleString('en-US', {
    timeZone: tz || 'UTC', hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const [actualH, actualM] = formatted.split(':').map(Number);
  // How far off are we from the requested local clock time?
  const driftMin = (actualH * 60 + actualM) - (localHour * 60 + localMinute);
  // Shift the instant back by the drift to land on the requested local time
  return new Date(naive.getTime() - driftMin * 60000).toISOString();
}

// ── Static data pools ────────────────────────────────────────────────────────

const GENDERS = ['Male', 'Female', 'Non-binary'];
const AGE_RANGES = ['18-25', '26-35', '36-45', '46-55', '56-65'];
const REFERRAL_SOURCES = ['Self-referred', 'Primary care physician', 'Insurance panel', 'Employee Assistance Program', 'School counselor', 'Previous therapist'];
const LIVING_SITUATIONS = ['Lives alone', 'With partner', 'With partner and children', 'With roommates', 'With parents', 'Single parent household'];
const NOTE_FORMATS = ['SOAP', 'DAP', 'BIRP', 'GIRP'];
const ORIENTATIONS = ['CBT', 'DBT-informed', 'Psychodynamic', 'EMDR', 'Solution-focused', 'Integrative'];

// Intentional duplicates (Sarah ×2, Michael ×2, Alex ×2) — lets you test agent disambiguation
const FIRST_NAMES = [
  'Sarah', 'Sarah',
  'Michael', 'Michael',
  'Alex', 'Alex',
  'Jordan', 'Taylor', 'Chris',
  'Maria', 'Marcus', 'Jessica',
  'David', 'Emily', 'James',
  'Olivia', 'Daniel', 'Ashley',
  'Ryan', 'Priya',
];

const LAST_NAMES = [
  'Martinez', 'Chen', 'Thompson', 'Nguyen', 'Patel',
  'Williams', 'Garcia', 'Johnson', 'Brown', 'Davis',
  'Kim', 'Wilson', 'Anderson', 'Thomas', 'Jackson',
  'Robinson', 'Lee', 'Clark', 'Hall', 'Ramirez',
];

// Generate a fake US E.164 number (555 prefix — non-routable, safe for demos)
function fakePhone() {
  return `+1555${String(rand(1000000, 9999999))}`;
}

// ── Clinical archetypes ──────────────────────────────────────────────────────

const ARCHETYPES = {
  life_transition_depression: {
    label: 'Depression + Anxiety (Life Transition)',
    has_passive_si: true,   // — note in risk_screening mentions passive SI
    presenting_concerns: 'Client presents with persistent low mood, anhedonia, fatigue, and difficulty concentrating following a significant life transition. Reports increased social withdrawal and disrupted sleep.',
    diagnoses: 'F32.1 - Major Depressive Disorder, Moderate; F41.1 - Generalized Anxiety Disorder',
    risk_screening: 'Denies active suicidal ideation. Endorses passive thoughts of not wanting to be here during worst periods. No plan or intent. Safety plan in place.',
    treatment_goals: '1. Reduce depressive symptoms as measured by PHQ-9. 2. Develop adaptive coping strategies for life transition stressors. 3. Rebuild social support network.',
    mental_health_history: 'One prior depressive episode in early 20s, resolved without formal treatment. No prior hospitalizations. No current psychiatric medications.',
    substance_use: 'Occasional alcohol use, 1-2 drinks on weekends. Denies other substance use.',
    family_social_history: 'Parents divorced during adolescence. One sibling, limited contact. Small but close friend group, less engaged recently due to depression.',
    mental_status_observations: 'Alert and oriented x4. Affect constricted, mood depressed. Speech normal rate and volume. Thought process linear. Insight good, judgment intact.',
    strengths_protective_factors: 'Strong insight, motivated for change, stable employment, supportive partner.',
    phq9_baseline: rand(14, 20),
    gad7_baseline: rand(10, 15),
  },
  trauma_ptsd: {
    label: 'Trauma / PTSD Presentation',
    is_trauma: true,        // → triggers PCL-5 arc
    has_passive_si: true,   // → triggers a C-SSRS administration
    presenting_concerns: 'Client presents with intrusive memories, hypervigilance, emotional numbing, and avoidance behaviours following a traumatic event. Reports sleep disturbance and startle response.',
    diagnoses: 'F43.10 - Post-Traumatic Stress Disorder; F41.1 - Generalized Anxiety Disorder',
    risk_screening: 'Denies current suicidal ideation. History of self-harm in adolescence, none in past 5 years. Safety plan reviewed.',
    treatment_goals: '1. Reduce PTSD symptom severity as measured by PCL-5. 2. Process traumatic memories using evidence-based trauma modality. 3. Restore daily functioning and sleep quality.',
    mental_health_history: 'Prior trauma exposure with subthreshold symptoms managed informally. One course of supportive therapy 4 years ago.',
    substance_use: 'Reports increased alcohol use since trauma exposure, approximately 4-5 drinks per week. Client acknowledges using alcohol to manage intrusive symptoms.',
    family_social_history: 'Grew up in a home with parental conflict. Primary support is one close friend. Partner aware of some trauma history, not all details.',
    mental_status_observations: 'Alert and oriented x4. Hypervigilant, scanning room intermittently. Affect restricted, mood anxious. Thought process intact. Avoids direct eye contact at times.',
    strengths_protective_factors: 'High motivation, prior therapy experience, strong values around recovery, stable housing.',
    phq9_baseline: rand(12, 18),
    gad7_baseline: rand(12, 18),
    pcl5_baseline: rand(45, 65),
  },
  anxiety_primary: {
    label: 'Anxiety Primary (GAD / Social)',
    presenting_concerns: 'Client presents with excessive worry across multiple life domains, physical tension, and difficulty tolerating uncertainty. Reports significant social anxiety impacting work performance and relationships.',
    diagnoses: 'F41.1 - Generalized Anxiety Disorder; F40.10 - Social Anxiety Disorder',
    risk_screening: 'Denies suicidal or homicidal ideation. No history of self-harm. Low risk at this time.',
    treatment_goals: '1. Reduce GAD-7 score through structured worry management. 2. Develop distress tolerance and mindfulness skills. 3. Reduce avoidance of social and professional situations.',
    mental_health_history: 'Anxiety symptoms present since adolescence, never treated formally. Describes high-achieving personality with chronic worry.',
    substance_use: 'Denies alcohol or substance use. Reports caffeine use is high (4-6 cups daily) and client is open to reducing.',
    family_social_history: 'Grew up with anxious mother. High-achieving family with implicit expectations. Currently in a stable relationship but reports anxiety about conflict.',
    mental_status_observations: 'Alert and oriented x4. Anxious affect, frequently self-corrects mid-sentence. Speech slightly rapid. Thought process organised. Good insight.',
    strengths_protective_factors: 'Highly intelligent, strong problem-solving skills, motivated, supportive partner.',
    phq9_baseline: rand(6, 12),
    gad7_baseline: rand(15, 21),
  },
  burnout_work_stress: {
    label: 'Burnout / Work Stress',
    presenting_concerns: 'Client presents with emotional exhaustion, depersonalisation, and reduced sense of professional efficacy. Reports difficulty setting boundaries at work and persistent fatigue even after rest.',
    diagnoses: 'Z73.0 - Burnout; F32.0 - Major Depressive Disorder, Mild; F41.1 - Generalized Anxiety Disorder',
    risk_screening: 'Denies suicidal ideation. Reports feeling "trapped" at times but distinguishes from wanting to die. No plan or intent.',
    treatment_goals: '1. Identify and challenge beliefs driving overwork and difficulty with boundaries. 2. Develop sustainable self-care routines. 3. Reduce burnout symptoms over 12 weeks.',
    mental_health_history: 'No prior mental health treatment. Client has historically dismissed emotional difficulties and pushed through.',
    substance_use: 'Reports 2-3 glasses of wine most evenings to "decompress." Ambivalent about this pattern.',
    family_social_history: 'First-generation professional, carries significant financial and emotional responsibility for family. Partner supportive but frustrated with client\'s unavailability.',
    mental_status_observations: 'Alert and oriented x4. Flat affect, reports feeling "empty." Speech slow, low energy. Thought process intact. Limited insight initially into impact of work culture on wellbeing.',
    strengths_protective_factors: 'Strong commitment to growth, partner support, financial stability, good physical health.',
    phq9_baseline: rand(10, 16),
    gad7_baseline: rand(8, 14),
  },
  grief_bereavement: {
    label: 'Grief / Bereavement',
    presenting_concerns: 'Client presents following the loss of a close family member. Reports waves of intense grief, difficulty concentrating, disrupted routine, and sense of purposelessness. Grief complicated by ambivalent relationship with deceased.',
    diagnoses: 'F43.21 - Adjustment Disorder with Depressed Mood; Z63.4 - Uncomplicated Bereavement',
    risk_screening: 'Denies active suicidal ideation. Endorses wish to "be with" the deceased at worst moments — no plan or intent. Safety planning completed.',
    treatment_goals: '1. Process grief in a supported and structured way. 2. Integrate loss into ongoing life narrative. 3. Restore daily functioning and reconnect with sources of meaning.',
    mental_health_history: 'No prior formal mental health treatment. One prior significant loss (parent) handled without support. Reports that loss "shaped" current presentation.',
    substance_use: 'Denies alcohol or substance use. Reports loss of appetite and disrupted eating patterns.',
    family_social_history: 'Close family unit, though currently avoiding family gatherings due to grief triggers. Relies heavily on one sibling for support.',
    mental_status_observations: 'Alert and oriented x4. Tearful throughout session, affect labile. Speech normal. Thought process intact with ruminative quality around loss. Insight good.',
    strengths_protective_factors: 'Strong family support, spiritual beliefs, motivated to honour the deceased through growth.',
    phq9_baseline: rand(11, 17),
    gad7_baseline: rand(7, 13),
  },
  adjustment_disorder: {
    label: 'Adjustment Disorder',
    presenting_concerns: 'Client presents with emotional and behavioural symptoms in response to an identifiable stressor. Reports difficulty managing daily responsibilities and heightened distress disproportionate to the stressor\'s objective severity.',
    diagnoses: 'F43.23 - Adjustment Disorder with Mixed Anxiety and Depressed Mood',
    risk_screening: 'Denies suicidal or homicidal ideation. No self-harm history. Low risk.',
    treatment_goals: '1. Develop coping skills tailored to identified stressor. 2. Reframe cognitive distortions around the stressor. 3. Restore pre-morbid level of functioning within 3 months.',
    mental_health_history: 'One prior episode of adjustment disorder following job loss, resolved within 6 months without formal treatment.',
    substance_use: 'Denies use. Reports stress eating as primary coping mechanism.',
    family_social_history: 'Stable family relationships. Strong support network. Stressor is occupational in nature — recent restructuring at work.',
    mental_status_observations: 'Alert and oriented x4. Mildly anxious affect, mood dysthymic. Speech normal. Thought process intact. Good insight and motivation.',
    strengths_protective_factors: 'High resilience, prior adaptive coping, strong social support, good problem-solving history.',
    phq9_baseline: rand(7, 13),
    gad7_baseline: rand(8, 14),
  },

  // ── Couple archetypes ────────────────────────────────────────────────────
  couple_communication: {
    label: 'Couple — Communication Breakdown',
    client_type: 'couple',
    age_range_override: '32-48',
    presenting_concerns: 'Couple presents with chronic communication difficulties characterised by escalating conflict, criticism-defensiveness cycles, and emotional disconnection. Both partners report feeling unheard. One identifies as the "pursuer," the other as "withdrawer."',
    diagnoses: 'Z63.0 - Problems in relationship with spouse or partner',
    risk_screening: 'No intimate partner violence reported by either partner during individual or joint screening. No suicidal or homicidal ideation. No firearms in home. Safety reviewed.',
    treatment_goals: '1. Reduce reactive communication patterns and increase emotional attunement using EFT-informed interventions. 2. Identify and interrupt the pursue-withdraw cycle. 3. Rebuild trust and affectionate behaviours over 12-16 sessions.',
    mental_health_history: 'Neither partner has prior individual or couples therapy. Both report stable individual mental health outside of relationship distress.',
    substance_use: 'Both partners report social alcohol use, no concerns. No other substances.',
    family_social_history: 'Together 11 years, married 7. Two children ages 6 and 9. Both partners working professionals with demanding schedules. Family-of-origin patterns differ markedly — pursuer raised in expressive household, withdrawer raised in conflict-avoidant household.',
    mental_status_observations: 'Both partners alert and oriented x4. Affect varies during session — pursuing partner more emotionally activated, withdrawing partner more constricted. Demonstrated capacity to slow down with coaching.',
    strengths_protective_factors: 'Strong commitment to relationship and co-parenting. Both partners motivated. Shared values. Good extended family support.',
    phq9_baseline: rand(5, 11),
    gad7_baseline: rand(7, 13),
  },
  couple_infidelity: {
    label: 'Couple — Infidelity Recovery',
    client_type: 'couple',
    age_range_override: '36-52',
    is_trauma: true,        // injured partner shows trauma-like sx → PCL-5
    has_passive_si: true,
    pcl5_baseline: rand(38, 55),
    presenting_concerns: 'Couple presents 6 weeks after disclosure of an extramarital affair by one partner. Injured partner reports intrusive thoughts, sleep disruption, and hypervigilance. Involved partner reports remorse and motivation to repair. Both report uncertainty about whether to continue the relationship.',
    diagnoses: 'Z63.0 - Problems in relationship with spouse or partner; F43.21 - Adjustment Disorder with Depressed Mood (injured partner)',
    risk_screening: 'No suicidal or homicidal ideation in either partner. No history of self-harm. No IPV. Both partners contracted for safety. Safety plan provided to injured partner given symptom acuity.',
    treatment_goals: '1. Stabilise crisis phase using Gottman-informed affair recovery framework. 2. Support injured partner\'s trauma processing in parallel individual work. 3. Rebuild safety, transparency, and over time, trust. 4. Couple to make informed decision about future together by month 6.',
    mental_health_history: 'No prior couples therapy. Injured partner had brief individual therapy in 20s. Involved partner has no prior treatment.',
    substance_use: 'Injured partner reports increased alcohol use since disclosure (3-4 drinks most evenings). Discussed in safety planning.',
    family_social_history: 'Married 14 years. Three children ages 4, 8, 11. Children unaware. Both partners have supportive extended family. Affair partner is no longer involved in either partner\'s life.',
    mental_status_observations: 'Injured partner: tearful throughout, hypervigilant, mood depressed, affect labile. Involved partner: subdued, takes responsibility verbally, affect appropriate to context.',
    strengths_protective_factors: 'Both partners deeply value the family unit. Involved partner has demonstrated full transparency (devices, schedule). Strong financial stability. Shared spiritual beliefs.',
    phq9_baseline: rand(11, 18),
    gad7_baseline: rand(12, 18),
  },

  // ── Family archetypes ────────────────────────────────────────────────────
  family_adolescent: {
    label: 'Family — Adolescent Behavioural',
    client_type: 'family',
    age_range_override: '14-46',
    presenting_concerns: 'Family presents with concerns about a 15-year-old\'s declining school performance, increased irritability, and recent boundary-pushing behaviour (curfew violations, secretive phone use). Parents report feeling shut out. Adolescent reports parents are "controlling" and don\'t understand them.',
    diagnoses: 'Z62.820 - Parent-child relational problem; F43.23 - Adjustment Disorder with Mixed Anxiety and Depressed Mood (adolescent, provisional)',
    risk_screening: 'Adolescent screened individually — denies suicidal ideation, no self-harm, no substance use. Parents endorse stable safety at home. No IPV. Firearms not in home.',
    treatment_goals: '1. Open and structure family communication using structural family therapy frame. 2. Support adolescent in developmentally-appropriate autonomy negotiation. 3. Reduce parent-adolescent reactivity. 4. Identify and address any underlying mood symptoms in the adolescent.',
    mental_health_history: 'No prior family therapy. Adolescent has not received individual treatment. Mother has history of treated postpartum depression (resolved). Father reports no prior treatment.',
    substance_use: 'Parents: social alcohol only. Adolescent: denies use, screened privately.',
    family_social_history: 'Two-parent intact household. One younger sibling age 11. Both parents working professionals. Family relocated 18 months ago — adolescent has not yet established stable peer group in new community.',
    mental_status_observations: 'Adolescent: guarded initially, opened up when seen alone. Affect constricted, mood mildly depressed. Mother: anxious, tearful at times, highly engaged. Father: more reserved, intellectualises, shows care through problem-solving.',
    strengths_protective_factors: 'Two engaged parents. Stable housing and finances. Family willing to attend together. Adolescent willing to participate.',
    phq9_baseline: rand(9, 14),
    gad7_baseline: rand(8, 13),
  },
  family_blended: {
    label: 'Family — Blended Family Adjustment',
    client_type: 'family',
    age_range_override: '12-44',
    presenting_concerns: 'Blended family presents 18 months after parental remarriage with ongoing tension between stepparent and adolescent stepchildren. Reports of authority disputes, loyalty conflicts, and difficulty establishing household norms. Couple subsystem strained by parenting disagreements.',
    diagnoses: 'Z63.8 - Other specified problems related to primary support group; Z62.820 - Parent-child relational problem',
    risk_screening: 'No suicidal or homicidal ideation in any family member. No physical aggression. Verbal conflict reported but within normal family range. Safety reviewed.',
    treatment_goals: '1. Strengthen the parent-stepparent couple subsystem as a unified leadership team. 2. Clarify roles and household norms collaboratively. 3. Support stepchildren in maintaining loyalty to non-residential parent without splitting. 4. Build stepparent-stepchild relationships at developmentally appropriate pace.',
    mental_health_history: 'Biological mother: history of treated anxiety. Stepfather: no prior treatment. Both adolescents: no prior treatment. Father (non-residential) involved and supportive of therapy.',
    substance_use: 'Adults: social alcohol only. Adolescents: denies use.',
    family_social_history: 'Mother and stepfather married 18 months. Two adolescent stepchildren live primarily with mother and stepfather, every other weekend with biological father. Stepfather has no biological children. Co-parenting relationship between mother and biological father is cooperative.',
    mental_status_observations: 'Mother: caught between roles, tearful when discussing children. Stepfather: frustrated but committed, struggles to articulate emotional experience. Adolescents: oppositional toward stepfather, warm with mother, divided loyalties evident.',
    strengths_protective_factors: 'Cooperative co-parenting with biological father. Adults committed to making blended family work. Adolescents securely attached to biological mother. Stable housing and finances.',
    phq9_baseline: rand(7, 12),
    gad7_baseline: rand(8, 13),
  },

  // ── Child / Adolescent archetypes ─────────────────────────────────────────
  child_school_anxiety: {
    label: 'Child — School Anxiety / Refusal',
    client_type: 'child',
    age_range_override: '8-11',
    presenting_concerns: 'Child presents with school avoidance behaviours over the past 2 months — somatic complaints (stomachaches, headaches) on school mornings, tearfulness at drop-off, and three full school refusals in the past month. Sleep disrupted Sunday nights. Parents report no precipitating event identified.',
    diagnoses: 'F40.218 - Specific Phobia, situational (school); F93.0 - Separation Anxiety Disorder (provisional)',
    risk_screening: 'Age-appropriate screening with parent present. Child denies thoughts of self-harm. No abuse concerns identified. Pediatrician consulted regarding somatic complaints — medical workup negative.',
    treatment_goals: '1. Establish therapeutic rapport with child using developmentally-appropriate play and CBT techniques. 2. Develop graduated school re-entry plan in coordination with school. 3. Coach parents on supportive responses to anxiety without reinforcing avoidance. 4. Address any underlying separation anxiety.',
    mental_health_history: 'No prior mental health treatment. Pediatrician ruled out medical causes for somatic complaints. Mother reports brief history of anxiety in childhood, now managed.',
    substance_use: 'Not applicable — child. Family screening: parents social alcohol only, no substance use in home.',
    family_social_history: 'Two-parent home. One younger sibling age 5. Both parents work, child in after-school care. School transition (new building this year) coincides with symptom onset. Strong extended family with weekly grandparent visits.',
    mental_status_observations: 'Child: shy initially, warmed up with play materials, age-appropriate engagement. Affect anxious early in session, more relaxed by end. Vocabulary above grade level. Bright affect when discussing favoured activities.',
    strengths_protective_factors: 'Engaged parents, supportive school environment willing to coordinate, strong extended family, child has multiple interests outside school.',
    phq9_baseline: rand(4, 8),
    gad7_baseline: rand(8, 13),
  },
  adolescent_depression: {
    label: 'Adolescent — Depression / Social Withdrawal',
    client_type: 'child',
    age_range_override: '14-17',
    has_passive_si: true,   // risk screening mentions passive SI → C-SSRS

    presenting_concerns: 'Adolescent presents at parents\' request following 4 months of social withdrawal, declining grades, and increased screen time / decreased sleep. Adolescent denies symptoms initially but acknowledges feeling "tired all the time" and "not caring about anything." No identified precipitating event.',
    diagnoses: 'F32.1 - Major Depressive Disorder, Moderate (provisional, evaluating); F41.1 - Generalized Anxiety Disorder',
    risk_screening: 'Adolescent screened individually with parent informed of limits of confidentiality. Endorses passive suicidal ideation in past month — "I wouldn\'t mind if I didn\'t wake up" — denies plan, intent, means. Safety plan completed with adolescent and reviewed with parents per Y-PSC framework.',
    treatment_goals: '1. Build therapeutic alliance with adolescent. 2. Reduce depressive symptoms using CBT-A protocol. 3. Reactivate behavioural engagement in previously valued activities. 4. Support family communication and parental responses to mood symptoms. 5. Coordinate with school counsellor and pediatrician.',
    mental_health_history: 'No prior treatment. No prior crisis episodes. No history of self-harm. Family history positive for depression on maternal side.',
    substance_use: 'Adolescent denies alcohol or substance use during private screening. No concerns endorsed by parents.',
    family_social_history: 'Two-parent intact household. Younger sibling age 12. Strong family unit. Adolescent previously had close peer group, has withdrawn from most friends in past 3 months. Active in sport prior to symptom onset, has stopped attending practice.',
    mental_status_observations: 'Adolescent: minimal eye contact initially, monosyllabic responses opening session. Affect flat. Speech low volume, slowed. Engaged more meaningfully in second half of session when seen without parents. Insight emerging.',
    strengths_protective_factors: 'Engaged parents who responded promptly to changes. No prior episodes. History of social and athletic engagement to draw on for behavioural activation. Adolescent willing to attend, even if reluctantly.',
    phq9_baseline: rand(13, 19),
    gad7_baseline: rand(11, 16),
  },
};

// ── Score trajectory generators ──────────────────────────────────────────────

function buildScoreArc(baseline, trajectory, numSessions, minScore, maxImprovement) {
  const scores = [baseline];
  let current = baseline;
  for (let i = 1; i < numSessions; i++) {
    let delta;
    if (trajectory === 'strong_responder') {
      delta = -(rand(2, 4));
    } else if (trajectory === 'moderate_responder') {
      delta = i % 3 === 0 ? rand(1, 2) : -(rand(1, 3)); // occasional setback
    } else {
      // slow_responder — minimal progress, occasional worsening
      delta = rand(0, 3) < 2 ? -(rand(0, 1)) : rand(0, 2);
    }
    current = Math.max(minScore, Math.min(baseline, current + delta));
    scores.push(current);
  }
  return scores;
}

// ── Session note content pools ────────────────────────────────────────────────

const SESSION_THEMES = [
  {
    subjective: 'Client reports a difficult week with increased rumination and difficulty sleeping. Expressed frustration with slow progress and questioned whether therapy is helping. Also noted a brief positive moment — reconnecting with a friend.',
    objective: 'Presented with constricted affect, mildly tearful at start of session. Affect brightened when discussing the positive interaction. Maintained good eye contact throughout.',
    assessment: 'Client is in an ambivalent phase of treatment — showing initial progress while experiencing natural resistance. The reconnection with the friend is a meaningful behavioural activation target.',
    plan: 'Continue CBT work on cognitive distortions around progress. Assign behavioural activation homework — schedule one social activity before next session. Explore ambivalence using motivational interviewing techniques.',
  },
  {
    subjective: 'Client reports completing the homework task and describes feeling "surprised" by how much it helped. Sleep slightly improved. Reports ongoing work-related stress as primary stressor this week.',
    objective: 'More animated than previous sessions. Smile appropriate and spontaneous. Speech normal rate. Collaborative and engaged throughout.',
    assessment: 'Positive response to behavioural activation. Work stress remains a maintaining factor for symptoms — warrants direct exploration. Client demonstrating increased insight.',
    plan: 'Introduce thought record for work-related cognitive distortions. Continue monitoring PHQ-9. Explore role of perfectionistic standards in work stress narrative.',
  },
  {
    subjective: 'Client arrived late and appeared distressed. Disclosed a conflict with a family member over the weekend that triggered strong shame response. Reports difficulty self-soothing.',
    objective: 'Tearful on arrival, composure returned within first 15 minutes. Engaged in active processing. Endorsed shame and self-blame. Denied any suicidal ideation when screened.',
    assessment: 'Shame-based cognitions are a significant clinical target — linked to core beliefs around unworthiness. The conflict appears to have activated early relational schema.',
    plan: 'Begin compassion-focused work on shame response. Revisit cognitive model with focus on core beliefs. Safety check completed — client contracted for safety. No change in risk level.',
  },
  {
    subjective: 'Client reports a "better week overall." Practiced thought records independently and found them moderately helpful. Expressed interest in learning more coping tools.',
    objective: 'Calm, engaged affect. Good eye contact. More forthcoming with emotional content than in early sessions. Evidence of growing therapeutic alliance.',
    assessment: 'Client is consolidating CBT skills and beginning to generalise them outside of sessions. Therapeutic alliance is strong and supports deeper exploration.',
    plan: 'Introduce distress tolerance skills. Review thought record homework together. Begin exploration of longer-term relational patterns contributing to presenting concerns.',
  },
  {
    subjective: 'Client disclosed a recent panic-like episode at work, first in several months. Expressed concern about regression. Noted that they had managed it without leaving the situation — recognised this as growth.',
    objective: 'Anxious presentation, though less dysregulated than the event itself suggested. Able to identify physical sensations and cognitive chain during episode. Self-aware and reflective.',
    assessment: 'The client\'s management of the panic episode reflects meaningful skill acquisition even as symptoms temporarily spiked. This is a clinically significant positive indicator framed incorrectly by client as failure.',
    plan: 'Reframe panic episode as evidence of progress. Psychoeducation on symptom fluctuation and non-linear recovery. Introduce interoceptive awareness exercise for between-session use.',
  },
  {
    subjective: 'Client reports feeling "more like themselves" for the first time since beginning treatment. Completed a previously avoided task at work. Sleep is significantly improved.',
    objective: 'Brighter affect, spontaneous humour present. Strong eye contact. Body language open. Endorsed improvement in most domains.',
    assessment: 'Clinically meaningful symptom reduction across presenting concerns. Client is consolidating gains and building self-efficacy. Approaching readiness for maintenance phase.',
    plan: 'Begin discussion of termination trajectory. Relapse prevention planning. Identify early warning signs and personal coping toolkit. Continue PHQ-9 monitoring.',
  },
  {
    subjective: 'Client presented with a setback following a stressful family visit. Reports mood dip and increased anxiety over the past week. Concerned about what this means for overall progress.',
    objective: 'Affect mildly dysthymic, but client quickly engaged and began problem-solving. No vegetative signs. PHQ-9 elevated from previous week. Denied suicidal ideation.',
    assessment: 'Temporary symptom exacerbation in response to clear stressor — this is expected and does not indicate regression. Client demonstrated adaptive coping within the session itself.',
    plan: 'Normalise fluctuation in recovery trajectory. Revisit thought record with focus on catastrophising. Reinforce coping plan. Review safety — no concerns at this time.',
  },
  {
    subjective: 'Final scheduled session. Client reflects positively on treatment process and acknowledges significant growth. Identifies ongoing vulnerabilities and has a clear coping plan.',
    objective: 'Engaged, reflective, mildly bittersweet affect appropriate to termination. Articulated insights clearly. Expressed genuine confidence in ability to manage future stressors.',
    assessment: 'Treatment goals substantially met. Client has internalized cognitive-behavioural skills, improved affect regulation, and demonstrated resilience across multiple stressors.',
    plan: 'Termination completed. Open door policy discussed. Referral information provided should symptoms re-escalate. Client to follow up with PCP regarding any medication considerations.',
  },
];

// ── Main route ────────────────────────────────────────────────────────────────

router.post('/demo-patient', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const therapistId = req.therapist.id;

    // Pick random configuration. Client type comes from the archetype itself
    // (defaults to 'individual' for the original archetypes that don't set one).
    const archetypeKey  = pick(Object.keys(ARCHETYPES));
    const archetype     = ARCHETYPES[archetypeKey];
    const clientType    = archetype.client_type || 'individual';
    const trajectory    = pick(['strong_responder', 'moderate_responder', 'slow_responder']);

    // Age range tailored to client type:
    //   - child:  8–17 (a single client)
    //   - couple: identifying client age 30–55, partner similar
    //   - family: identifying client (typically the parent presenting) 30–50
    //   - individual: 22–62 (existing default)
    let age, ageRange;
    if (clientType === 'child') {
      // Use the override range for both age and the AGE_RANGES dropdown
      const [lo, hi] = (archetype.age_range_override || '8-17').split('-').map(Number);
      age = rand(lo, hi);
      ageRange = archetype.age_range_override || `${lo}-${hi}`;
    } else if (clientType === 'couple' || clientType === 'family') {
      const [lo, hi] = (archetype.age_range_override || '32-48').split('-').map(Number);
      age = rand(lo, hi);
      ageRange = archetype.age_range_override || `${lo}-${hi}`;
    } else {
      age = rand(22, 62);
      ageRange = pick(AGE_RANGES);
    }

    const gender        = pick(GENDERS);
    const orientation   = pick(ORIENTATIONS);
    const numSessions   = rand(4, 8);
    const noteFormat    = pick(NOTE_FORMATS);
    const clientId      = `DEMO-${uid()}`;

    // For couple / family types, the display name represents the relational
    // unit (e.g., "The Anderson Family", "Rivera & Chen") rather than a
    // single individual. Members JSON tracks the labels Miwa shows in the
    // app for the people in the case.
    let displayName, members = null;
    if (clientType === 'couple') {
      const lastA = pick(LAST_NAMES);
      const lastB = pick(LAST_NAMES);
      displayName = lastA === lastB ? `The ${lastA} Couple` : `${lastA} & ${lastB}`;
      members = JSON.stringify([
        `${pick(FIRST_NAMES)} ${lastA}`,
        `${pick(FIRST_NAMES)} ${lastB}`,
      ]);
    } else if (clientType === 'family') {
      const familyLast = pick(LAST_NAMES);
      displayName = `The ${familyLast} Family`;
      // 2 parents + 1–2 children
      const numChildren = rand(1, 2);
      const memberList = [
        `${pick(FIRST_NAMES)} ${familyLast} (parent)`,
        `${pick(FIRST_NAMES)} ${familyLast} (parent)`,
      ];
      for (let i = 0; i < numChildren; i++) {
        memberList.push(`${pick(FIRST_NAMES)} ${familyLast} (child)`);
      }
      members = JSON.stringify(memberList);
    } else if (clientType === 'child') {
      // The child is the identified client, but we record guardians as members.
      const childLast = pick(LAST_NAMES);
      displayName = `${pick(FIRST_NAMES)} ${childLast}`;
      members = JSON.stringify([
        `${pick(FIRST_NAMES)} ${childLast} (guardian)`,
        `${pick(FIRST_NAMES)} ${childLast} (guardian)`,
      ]);
    } else {
      displayName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    }

    const phone         = fakePhone();

    // PHQ-9 and GAD-7 arcs
    const phq9Arc = buildScoreArc(archetype.phq9_baseline, trajectory, numSessions, 0, archetype.phq9_baseline);
    const gad7Arc = buildScoreArc(archetype.gad7_baseline, trajectory, numSessions, 0, archetype.gad7_baseline);

    // ── Insert patient ──────────────────────────────────────────────────────
    const fakeEmail = `${displayName.toLowerCase().replace(/\s+/g, '.')}+demo@example.com`;

    // Overview text varies by client type — "couple", "family", and "child"
    // cases shouldn't read like a single individual's chart.
    const overviewByType = {
      couple:     `Couple in their ${age}s. Presenting with ${archetype.presenting_concerns.split('.')[0].toLowerCase()}.`,
      family:     `Family unit. Presenting with ${archetype.presenting_concerns.split('.')[0].toLowerCase()}.`,
      child:      `Child age ${age}. Presenting with ${archetype.presenting_concerns.split('.')[0].toLowerCase()}.`,
      individual: `${gender}, age ${age}. Presenting with ${archetype.presenting_concerns.split('.')[0].toLowerCase()}.`,
    };

    const patientResult = db.insert(
      `INSERT INTO patients (
        client_id, display_name, phone, email, preferred_contact_method,
        age, gender, age_range, referral_source, living_situation,
        presenting_concerns, diagnoses,
        risk_screening, treatment_goals,
        mental_health_history, substance_use,
        family_social_history, mental_status_observations,
        strengths_protective_factors,
        client_overview,
        client_type, members,
        therapist_id, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
      clientId, displayName, phone, fakeEmail, 'email',
      age, gender, ageRange,
      pick(REFERRAL_SOURCES), pick(LIVING_SITUATIONS),
      archetype.presenting_concerns,
      archetype.diagnoses,
      archetype.risk_screening,
      archetype.treatment_goals,
      archetype.mental_health_history,
      archetype.substance_use,
      archetype.family_social_history,
      archetype.mental_status_observations,
      archetype.strengths_protective_factors,
      overviewByType[clientType] || overviewByType.individual,
      clientType, members,
      therapistId,
    );
    const patientId = patientResult.lastInsertRowid;

    // ── Insert sessions ─────────────────────────────────────────────────────
    const today = new Date();
    const sessionIds = [];

    // Build the session-date schedule. Guarantees:
    //   1. The most recent session lands inside the CURRENT calendar week
    //      (Mon → today). This ensures a freshly-generated demo client
    //      shows up in the dashboard's "This Week" tile, regardless of
    //      whether the demo is created on Monday morning or Saturday night.
    //   2. The most recent session is randomized within that window
    //      instead of always being today, which looked artificial.
    //   3. Earlier sessions are spaced 5-7 days back so the historical
    //      arc still spans several weeks.
    //
    // sessionDaysAgo[i] = days from today for session i (chronological:
    //   index 0 = oldest, index numSessions-1 = most recent).
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    // Most recent = somewhere between today and (Mon of this week). On Mon
    // that's just today. On Sun that's 0-6 days ago.
    const mostRecentDaysAgo = rand(0, daysSinceMonday);
    const sessionDaysAgo = [];
    let cursor = mostRecentDaysAgo;
    sessionDaysAgo.unshift(cursor); // most recent first, will reverse below
    for (let i = 1; i < numSessions; i++) {
      cursor += rand(5, 7); // 5-7 day cadence working backward
      sessionDaysAgo.unshift(cursor);
    }
    // sessionDaysAgo is now [oldest, ..., most_recent] in chronological order

    for (let i = 0; i < numSessions; i++) {
      const daysAgo  = sessionDaysAgo[i];
      const sessDate = dateOffsetDays(today, -daysAgo);
      const theme    = SESSION_THEMES[i % SESSION_THEMES.length];

      // Build notes_json using the same field keys the frontend expects (subjective/objective/assessment/plan)
      let notesJson = null;
      if (noteFormat === 'SOAP') {
        notesJson = JSON.stringify({ SOAP: { subjective: theme.subjective, objective: theme.objective, assessment: theme.assessment, plan: theme.plan } });
      } else if (noteFormat === 'DAP') {
        // DAP uses subjective for the Data field (combined client report + clinician observations)
        notesJson = JSON.stringify({ DAP: { subjective: `${theme.subjective} ${theme.objective}`, assessment: theme.assessment, plan: theme.plan } });
      } else if (noteFormat === 'GIRP') {
        notesJson = JSON.stringify({ GIRP: { goals: theme.assessment, intervention: theme.objective, response: theme.subjective, plan: theme.plan } });
      } else {
        notesJson = JSON.stringify({ BIRP: { subjective: theme.subjective, objective: theme.objective, assessment: theme.assessment, plan: theme.plan } });
      }

      const sResult = db.insert(
        `INSERT INTO sessions (patient_id, therapist_id, session_date, note_format, subjective, objective, assessment, plan, notes_json, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`,
        patientId, therapistId, sessDate, noteFormat,
        theme.subjective, theme.objective, theme.assessment, theme.plan,
        notesJson,
      );
      sessionIds.push(sResult.lastInsertRowid);
    }

    // ── Insert PHQ-9 assessments ────────────────────────────────────────────
    const PHQ9_SEVERITY = (s) => s <= 4 ? 'Minimal' : s <= 9 ? 'Mild' : s <= 14 ? 'Moderate' : s <= 19 ? 'Moderately Severe' : 'Severe';
    const PHQ9_COLOR    = (s) => s <= 4 ? 'green' : s <= 9 ? 'yellow' : s <= 14 ? 'orange' : 'red';

    let prevPhq9 = null;
    for (let i = 0; i < numSessions; i++) {
      const score    = phq9Arc[i];
      const severity = PHQ9_SEVERITY(score);
      const color    = PHQ9_COLOR(score);
      const daysAgo  = sessionDaysAgo[i];
      const dateStr  = dateOffsetDays(today, -daysAgo);
      const baseline = prevPhq9 === null ? score : phq9Arc[0];
      const change   = prevPhq9 === null ? 0 : score - prevPhq9;
      const isImp    = prevPhq9 !== null && score < prevPhq9 ? 1 : 0;
      const isDet    = prevPhq9 !== null && score > prevPhq9 ? 1 : 0;
      const clinSig  = Math.abs(change) >= 5 ? 1 : 0;

      db.insert(
        `INSERT INTO assessments (patient_id, therapist_id, template_type, session_id,
          administered_at, responses, total_score, severity_level, severity_color,
          baseline_score, previous_score, score_change, is_improvement, is_deterioration,
          clinically_significant, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        patientId, therapistId, 'phq-9', sessionIds[i],
        `${dateStr}T10:00:00`,
        JSON.stringify({}),
        score, severity, color,
        phq9Arc[0], prevPhq9 ?? score, change, isImp, isDet,
        clinSig, 'completed', `${dateStr}T10:00:00`,
      );
      prevPhq9 = score;
    }

    // ── Insert GAD-7 assessments ────────────────────────────────────────────
    const GAD7_SEVERITY = (s) => s <= 4 ? 'Minimal' : s <= 9 ? 'Mild' : s <= 14 ? 'Moderate' : 'Severe';
    const GAD7_COLOR    = (s) => s <= 4 ? 'green' : s <= 9 ? 'yellow' : s <= 14 ? 'orange' : 'red';

    let prevGad7 = null;
    for (let i = 0; i < numSessions; i++) {
      const score    = gad7Arc[i];
      const severity = GAD7_SEVERITY(score);
      const color    = GAD7_COLOR(score);
      const daysAgo  = sessionDaysAgo[i];
      const dateStr  = dateOffsetDays(today, -daysAgo);
      const change   = prevGad7 === null ? 0 : score - prevGad7;
      const isImp    = prevGad7 !== null && score < prevGad7 ? 1 : 0;
      const isDet    = prevGad7 !== null && score > prevGad7 ? 1 : 0;
      const clinSig  = Math.abs(change) >= 4 ? 1 : 0;

      db.insert(
        `INSERT INTO assessments (patient_id, therapist_id, template_type, session_id,
          administered_at, responses, total_score, severity_level, severity_color,
          baseline_score, previous_score, score_change, is_improvement, is_deterioration,
          clinically_significant, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        patientId, therapistId, 'gad-7', sessionIds[i],
        `${dateStr}T10:00:00`,
        JSON.stringify({}),
        score, severity, color,
        gad7Arc[0], prevGad7 ?? score, change, isImp, isDet,
        clinSig, 'completed', `${dateStr}T10:00:00`,
      );
      prevGad7 = score;
    }

    // ── Insert progress alerts ──────────────────────────────────────────────
    const alerts = [];

    // Alert: initial risk flag if risk screening is not low
    if (archetype.risk_screening.toLowerCase().includes('passive') || archetype.risk_screening.toLowerCase().includes('endorses')) {
      alerts.push({
        type: 'RISK_FLAG',
        severity: 'HIGH',
        title: 'Risk screening: passive ideation noted',
        description: 'Client endorsed passive suicidal ideation during intake. Safety plan completed. Continue to monitor at each session.',
      });
    }

    // Alert: clinically significant improvement if strong/moderate responder
    const phq9Drop = phq9Arc[0] - phq9Arc[numSessions - 1];
    if (phq9Drop >= 5) {
      alerts.push({
        type: 'IMPROVEMENT_MILESTONE',
        severity: 'LOW',
        title: `PHQ-9 improved by ${phq9Drop} points`,
        description: `Client's PHQ-9 score dropped from ${phq9Arc[0]} to ${phq9Arc[numSessions - 1]} — a clinically significant reduction in depressive symptoms.`,
      });
    }

    // Alert: deterioration if slow responder
    if (trajectory === 'slow_responder') {
      alerts.push({
        type: 'DETERIORATION',
        severity: 'CRITICAL',
        title: 'Limited treatment response — consider review',
        description: 'Client has not demonstrated clinically significant improvement over the treatment period. Consider case review, modality adjustment, or higher level of care consultation.',
      });
    }

    for (const al of alerts) {
      db.insert(
        `INSERT INTO progress_alerts (patient_id, therapist_id, type, severity, title, description, is_read, created_at)
         VALUES (?,?,?,?,?,?,0,datetime('now'))`,
        patientId, therapistId, al.type, al.severity, al.title, al.description,
      );
    }

    // ── Insert upcoming appointment (tests Schedule + Pre-Session Briefs) ────
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setMinutes(50);

    db.insert(
      `INSERT INTO appointments (therapist_id, patient_id, client_code, appointment_type, scheduled_start, scheduled_end, duration_minutes, status)
       VALUES (?,?,?,?,?,?,?,?)`,
      therapistId, patientId, clientId,
      numSessions <= 1 ? 'intake' : 'individual',
      tomorrow.toISOString(), tomorrowEnd.toISOString(), 50, 'scheduled'
    );

    // ── Insert treatment plan with goals (tests Treatment Plan Agent) ──────
    try {
      const { lastInsertRowid: planId } = db.insert(
        "INSERT INTO treatment_plans (patient_id, therapist_id, status, summary, last_reviewed_at) VALUES (?,?,'active',?,datetime('now'))",
        patientId, therapistId, `Treatment plan for ${displayName} — ${archetype.label}`
      );

      // Parse treatment goals from archetype and create structured goals
      const goalTexts = (archetype.treatment_goals || '').split(/\d+\.\s*/).filter(Boolean);
      for (const goalText of goalTexts) {
        const isPhq = goalText.toLowerCase().includes('phq') || goalText.toLowerCase().includes('depress');
        const isGad = goalText.toLowerCase().includes('gad') || goalText.toLowerCase().includes('anxi');
        const targetMetric = isPhq ? 'PHQ-9 < 10' : isGad ? 'GAD-7 < 8' : null;
        const baseline = isPhq ? phq9Arc[0] : isGad ? gad7Arc[0] : null;
        const current = isPhq ? phq9Arc[numSessions - 1] : isGad ? gad7Arc[numSessions - 1] : null;
        const met = current !== null && targetMetric && (
          (isPhq && current < 10) || (isGad && current < 8)
        );

        db.insert(
          "INSERT INTO treatment_goals (plan_id, goal_text, target_metric, baseline_value, current_value, status) VALUES (?,?,?,?,?,?)",
          planId, goalText.trim(), targetMetric, baseline, current,
          met ? 'met' : (trajectory === 'slow_responder' ? 'active' : 'active')
        );
      }
    } catch (planErr) {
      console.error('[demo] Treatment plan creation error:', planErr.message);
    }

    // ── Insert proactive alerts (tests Dashboard alerts + bell notification) ──
    db.insert(
      "INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description) VALUES (?,?,?,?,?,?)",
      therapistId, patientId, 'OVERDUE_ASSESSMENT', 'MEDIUM',
      `${displayName} is due for a follow-up assessment`,
      `Last assessment was ${numSessions * 5} days ago. Consider sending a PHQ-9 or GAD-7.`
    );

    if (trajectory === 'slow_responder') {
      db.insert(
        "INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description) VALUES (?,?,?,?,?,?)",
        therapistId, patientId, 'DETERIORATION', 'HIGH',
        `${displayName} showing limited treatment response`,
        `PHQ-9 scores have not improved significantly over ${numSessions} sessions. Consider case review or modality adjustment.`
      );
    }

    // ── Insert checkin link (tests Check-in system) ──────────────────────────
    const crypto = require('crypto');
    const checkinToken = crypto.randomBytes(16).toString('hex');
    db.insert(
      "INSERT INTO checkin_links (token, patient_id, therapist_id, message, expires_at) VALUES (?,?,?,?,datetime('now','+7 days'))",
      checkinToken, patientId, therapistId, 'How have you been feeling since our last session?'
    );

    // ── PCL-5 (PTSD) for trauma archetypes ──────────────────────────────────
    // Score range 0-80; clinical cutoff ~33. Trajectory mirrors PHQ/GAD direction
    // for narrative consistency (improving overall = improving on all measures).
    if (archetype.is_trauma) {
      const baseline = archetype.pcl5_baseline || rand(40, 60);
      const PCL5_SEVERITY = (s) => s <= 32 ? 'Below threshold' : s <= 44 ? 'Probable PTSD' : s <= 60 ? 'Moderate PTSD' : 'Severe PTSD';
      const PCL5_COLOR    = (s) => s <= 32 ? 'green'  : s <= 44 ? 'yellow' : s <= 60 ? 'orange' : 'red';
      // Administer every other session (PCL-5 is longer, less frequent)
      let prev = null;
      let current = baseline;
      for (let i = 0; i < numSessions; i += 2) {
        // Trajectory delta scaled to PCL-5 range
        let delta;
        if (trajectory === 'strong_responder')        delta = -rand(4, 8);
        else if (trajectory === 'moderate_responder') delta = i % 4 === 0 ? rand(2, 4) : -rand(3, 6);
        else                                          delta = rand(0, 4) < 2 ? -rand(0, 2) : rand(0, 3);
        if (i === 0) current = baseline; else current = Math.max(0, Math.min(80, current + delta));
        const daysAgo = sessionDaysAgo[i];
        const dateStr = dateOffsetDays(today, -daysAgo);
        const change  = prev === null ? 0 : current - prev;
        const isImp   = prev !== null && current < prev ? 1 : 0;
        const isDet   = prev !== null && current > prev ? 1 : 0;
        const clinSig = Math.abs(change) >= 10 ? 1 : 0;
        db.insert(
          `INSERT INTO assessments (patient_id, therapist_id, template_type, session_id,
            administered_at, responses, total_score, severity_level, severity_color,
            baseline_score, previous_score, score_change, is_improvement, is_deterioration,
            clinically_significant, status, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          patientId, therapistId, 'pcl-5', sessionIds[i],
          `${dateStr}T10:30:00`,
          JSON.stringify({}),
          current, PCL5_SEVERITY(current), PCL5_COLOR(current),
          baseline, prev ?? current, change, isImp, isDet,
          clinSig, 'completed', `${dateStr}T10:30:00`,
        );
        prev = current;
      }
    }

    // ── C-SSRS (Suicide risk) for archetypes that flagged passive SI ────────
    // Most demos get one C-SSRS at session 2 documenting safety planning.
    // Higher-risk archetypes (adolescent_depression) get two.
    if (archetype.has_passive_si) {
      const idxs = archetype.label?.startsWith('Adolescent') ? [1, Math.max(2, numSessions - 2)] : [1];
      for (const i of idxs) {
        if (i >= numSessions) continue;
        const daysAgo = sessionDaysAgo[i];
        const dateStr = dateOffsetDays(today, -daysAgo);
        // Score 0-5: 0 wish to die, 1 SI, 2 SI w/ method, 3 SI w/ intent, 4 SI w/ plan
        // Demos document low-level (passive) SI: score 1.
        const score = 1;
        db.insert(
          `INSERT INTO assessments (patient_id, therapist_id, template_type, session_id,
            administered_at, responses, total_score, severity_level, severity_color,
            baseline_score, previous_score, score_change, is_improvement, is_deterioration,
            clinically_significant, status, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          patientId, therapistId, 'cssrs', sessionIds[i],
          `${dateStr}T10:45:00`,
          JSON.stringify({ wish_to_die: 1, nonspecific_si: 1, plan: 0, intent: 0, behavior_past_3mo: 0 }),
          score, 'Low (passive SI)', 'yellow',
          score, score, 0, 0, 0,
          0, 'completed', `${dateStr}T10:45:00`,
        );
      }
    }

    // ── Completed check-ins between sessions (mood ratings 1-5) ─────────────
    // Number scales with session count: 0-2 for short caseloads, 2-5 for longer.
    const numCheckins = Math.min(numSessions - 1, rand(2, 5));
    for (let i = 0; i < numCheckins; i++) {
      // Spread between sessions chronologically
      const baseDaysAgo = sessionDaysAgo[Math.min(i + 1, numSessions - 1)];
      const offsetWithinGap = rand(1, 3);
      const checkinDaysAgo = baseDaysAgo + offsetWithinGap;
      const completedDate = dateOffsetDays(today, -checkinDaysAgo);
      // Mood improves with strong/moderate trajectory, jagged for slow
      let mood;
      if (trajectory === 'strong_responder')        mood = Math.min(5, 2 + Math.floor(i * 0.6));
      else if (trajectory === 'moderate_responder') mood = rand(2, 4);
      else                                          mood = rand(1, 3);
      const note = pick([
        'Slept better this week. Practiced the breathing exercise twice.',
        'Tough Wednesday — work conflict triggered old patterns. Used grounding skills.',
        'Felt OK overall. Reached out to friend for first time in a while.',
        'Mood low Tuesday and Wednesday. Picked up by Friday.',
        'Decent week. Skipped one homework assignment.',
        'Argument at home set me back. Recovered faster than usual.',
      ]);
      const tok = crypto.randomBytes(16).toString('hex');
      db.insert(
        `INSERT INTO checkin_links (token, patient_id, therapist_id, message,
           sent_at, completed_at, expires_at, mood_score, mood_notes)
         VALUES (?,?,?,?,?,?,datetime(?,'+7 days'),?,?)`,
        tok, patientId, therapistId,
        'How have you been feeling since our last session?',
        `${completedDate}T08:00:00`, `${completedDate}T19:30:00`, `${completedDate}T08:00:00`,
        mood, note,
      );
    }

    // ── Treatment plan + goals derived from archetype ───────────────────────
    // Parses the numbered list in archetype.treatment_goals into 3 goal rows.
    try {
      const planResult = db.insert(
        `INSERT INTO treatment_plans (patient_id, therapist_id, summary, last_reviewed_at)
         VALUES (?,?,?,datetime('now','-7 days'))`,
        patientId, therapistId,
        `Active treatment plan focused on ${archetype.label.toLowerCase()}. Reviewed weekly; updated quarterly.`,
      );
      const planId = planResult.lastInsertRowid;
      // Crude split of "1. ... 2. ... 3. ..." into individual goal sentences
      const goalLines = String(archetype.treatment_goals || '')
        .split(/\d+\.\s+/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 4);
      goalLines.forEach((goalText, idx) => {
        const target = idx === 0 ? 'PHQ-9 < 10' : idx === 1 ? 'GAD-7 < 8' : 'Symptom self-report';
        const baselineVal = idx === 0 ? archetype.phq9_baseline : idx === 1 ? archetype.gad7_baseline : null;
        const currentVal  = idx === 0 ? phq9Arc[phq9Arc.length - 1] : idx === 1 ? gad7Arc[gad7Arc.length - 1] : null;
        db.insert(
          `INSERT INTO treatment_goals (plan_id, goal_text, target_metric, baseline_value, current_value, status)
           VALUES (?,?,?,?,?,?)`,
          planId, goalText, target, baselineVal, currentVal,
          trajectory === 'strong_responder' && idx === 0 ? 'met' : 'active',
        );
      });
    } catch (err) {
      console.warn('[demo] treatment plan insert skipped:', err.message);
    }

    // ── Past appointments (one per session) + 1-2 future appointments ──────
    // Past appointments are marked completed so they don't pollute "Today" but
    // do show up in Schedule history. Future appointments populate the Today
    // tile and Schedule calendar — telehealth modality lets the Meet flow fire.
    //
    // Times: spread across a realistic clinical day (8 AM, 9, 10, 11, 1 PM,
    // 2, 3, 4, 5 — skipping noon for lunch). Computed in the therapist's
    // preferred timezone so they don't display at 3 AM for PDT viewers.
    try {
      const tz = req.therapist?.preferred_timezone || 'America/Los_Angeles';
      const CLINICAL_HOURS = [8, 9, 10, 11, 13, 14, 15, 16, 17];
      const apptType = clientType === 'couple' ? 'couple session'
        : clientType === 'family' ? 'family session'
        : clientType === 'child'  ? 'individual session'
        :                            'individual session';

      // Past appointments — same dates as the session notes, varied hours so
      // the schedule history doesn't look like every session was at 3 PM.
      for (let i = 0; i < numSessions; i++) {
        const dateStr = dateOffsetDays(today, -sessionDaysAgo[i]);
        const hour    = pick(CLINICAL_HOURS);
        const startISO = localTimeToUtcIso(dateStr, hour, 0, tz);
        const endISO   = localTimeToUtcIso(dateStr, hour, 50, tz);
        db.insert(
          `INSERT INTO appointments (therapist_id, patient_id, client_code, client_display_name,
             appointment_type, scheduled_start, scheduled_end, duration_minutes, status,
             attendance_status, checked_in_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          therapistId, patientId, clientId, displayName,
          apptType, startISO, endISO, 50, 'completed',
          'checked_in', startISO,
        );
      }
      // Two future appointments — one 2 days out, one next week. Random hours
      // from the clinical pool so a caseload of 10 demos doesn't pile every
      // appointment onto the same hour.
      for (const offset of [2, 9]) {
        const dateStr  = dateOffsetDays(today, offset);
        const hour     = pick(CLINICAL_HOURS);
        const startISO = localTimeToUtcIso(dateStr, hour, 0, tz);
        const endISO   = localTimeToUtcIso(dateStr, hour, 50, tz);
        db.insert(
          `INSERT INTO appointments (therapist_id, patient_id, client_code, client_display_name,
             appointment_type, scheduled_start, scheduled_end, duration_minutes, status,
             attendance_status)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          therapistId, patientId, clientId, displayName,
          apptType, startISO, endISO, 50, 'scheduled', 'pending',
        );
      }
    } catch (err) {
      console.warn('[demo] appointment insert skipped:', err.message);
    }

    persist();

    res.json({
      success: true,
      patient_id:       patientId,
      client_id:        clientId,
      display_name:     displayName,
      phone,
      email:            fakeEmail,
      archetype:        archetypeKey,
      trajectory,
      age,
      gender,
      sessions_created: numSessions,
      note_format:      noteFormat,
      phq9_start:       phq9Arc[0],
      phq9_end:         phq9Arc[numSessions - 1],
      gad7_start:       gad7Arc[0],
      gad7_end:         gad7Arc[numSessions - 1],
      alerts_created:   alerts.length + 1 + (trajectory === 'slow_responder' ? 1 : 0),
      appointment:      'Tomorrow at 10:00 AM',
      treatment_plan:   'Created with structured goals',
      checkin_link:     `https://miwa.care/checkin/${checkinToken}`,
      tests_covered:    [
        'Patient profile with full intake data',
        'Session notes in ' + noteFormat + ' format',
        'PHQ-9 + GAD-7 assessment trajectories',
        'Upcoming appointment (tomorrow 10am) — tests Schedule + Pre-Session Briefs',
        'Treatment plan with measurable goals — tests Treatment Plan panel',
        'Proactive alerts — tests Dashboard alerts + bell notification',
        'Progress alerts — tests Outcomes page',
        'Check-in link — tests client check-in system',
        'Phone + email — tests assessment/outreach delivery',
        trajectory === 'slow_responder' ? 'Deterioration alert — tests high severity alerting' : 'Standard trajectory',
      ],
    });
  } catch (err) {
    console.error('[demo] Error generating demo patient:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
