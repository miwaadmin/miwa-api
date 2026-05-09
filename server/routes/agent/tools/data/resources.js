/* ── Embedded data for agent tools ─────────────────────────────────────── */
const AGENT_RESOURCES = [
  { category: 'Assessment Guides', id: 'assessment-guides', items: [
    { name: 'PHQ-9 Patient Health Questionnaire', type: 'Depression Screening', url: 'https://www.phqscreeners.com/', source: 'Pfizer / PHQ Screeners' },
    { name: 'GAD-7 Generalized Anxiety Disorder Scale', type: 'Anxiety Screening', url: 'https://www.phqscreeners.com/', source: 'Pfizer / PHQ Screeners' },
    { name: 'PCL-5 PTSD Checklist', type: 'Trauma Screening', url: 'https://www.ptsd.va.gov/professional/assessment/adult-sr/ptsd-checklist.asp', source: 'VA National Center for PTSD' },
    { name: 'Columbia Suicide Severity Rating Scale (C-SSRS)', type: 'Suicide Risk Assessment', url: 'https://cssrs.columbia.edu/', source: 'Columbia Lighthouse Project', urgent: true },
    { name: 'ASRS-v1.1 Adult ADHD Self-Report Scale', type: 'ADHD Screening', url: 'https://www.hcp.med.harvard.edu/ncs/asrs.php', source: 'Harvard Medical School / WHO' },
    { name: 'AUDIT Alcohol Use Disorders Identification Test', type: 'Substance Use Screening', url: 'https://auditscreen.org/', source: 'World Health Organization' },
    { name: 'IDS / QIDS Depression Rating Scales', type: 'Depression Severity', url: 'https://ids-qids.org/', source: 'UT Southwestern Medical Center' },
    { name: 'SAMHSA Evidence-Based Screening Tools', type: 'Multi-Domain Toolkit', url: 'https://www.samhsa.gov/resource-search/ebp', source: 'SAMHSA.gov' },
  ]},
  { category: 'Clinical Protocols & Interventions', id: 'clinical-protocols', items: [
    { name: 'Cognitive Behavioral Therapy (CBT)', type: 'Evidence-Based Protocol', url: 'https://www.apa.org/ptsd-guideline/treatments/cognitive-behavioral-therapy', source: 'APA / Division 12' },
    { name: 'Dialectical Behavior Therapy (DBT)', type: 'Evidence-Based Protocol', url: 'https://behavioraltech.org/', source: 'Linehan Institute' },
    { name: 'Trauma-Focused CBT', type: 'Trauma Treatment', url: 'https://tfcbt.org/', source: 'National Child Traumatic Stress Network' },
    { name: 'Eye Movement Desensitization & Reprocessing (EMDR)', type: 'Trauma Treatment', url: 'https://www.emdria.org/', source: 'EMDR International Association' },
    { name: 'Motivational Interviewing (MI)', type: 'Behavioral Change', url: 'https://www.motivationalinterviewing.org/', source: 'MINT.org' },
    { name: 'Exposure Therapy Techniques', type: 'Anxiety Treatment', url: 'https://adaa.org/finding-help/treatment/exposure-therapy', source: 'ADAA' },
    { name: 'Solution-Focused Brief Therapy (SFBT)', type: 'Brief Intervention', url: 'https://www.sfbta.org/', source: 'SFBT Academy' },
    { name: 'Acceptance & Commitment Therapy (ACT)', type: 'Contextual Approach', url: 'https://contextualscience.org/', source: 'ACBS' },
  ]},
  { category: 'Crisis & Safety Resources', id: 'crisis-safety', items: [
    { name: '988 Suicide & Crisis Lifeline', type: 'Crisis Hotline', url: 'https://988lifeline.org/', source: '988lifeline.org', urgent: true },
    { name: 'Crisis Text Line', type: 'Crisis Hotline', url: 'https://www.crisistextline.org/', source: 'Crisis Text Line', urgent: true },
    { name: 'SAMHSA National Helpline', type: 'Crisis Hotline', url: 'https://www.samhsa.gov/find-help/national-helpline', source: 'SAMHSA', urgent: true },
    { name: 'Trevor Project (LGBTQ+ Crisis)', type: 'Specialized Crisis', url: 'https://www.thetrevorproject.org/', source: 'Trevor Project', urgent: true },
    { name: 'Trans Lifeline', type: 'Specialized Crisis', url: 'https://translifeline.org/', source: 'Trans Lifeline', urgent: true },
    { name: 'National Domestic Violence Hotline', type: 'Specialized Crisis', url: 'https://www.thehotline.org/', source: 'National DV Hotline', urgent: true },
    { name: 'Safety Planning Tool', type: 'Planning Resource', url: 'https://suicidepreventionlifeline.org/wp-content/uploads/2016/08/Brown_StanleySafetyPlanTemplate.pdf', source: 'AFSP / Brown & Stanley' },
  ]},
  { category: 'Suicide Prevention & Assessment', id: 'suicide-prevention', items: [
    { name: 'Ask Suicide-Screening Questions (ASQ)', type: 'Screening Tool', url: 'https://www.nimh.nih.gov/research/research-conducted-at-nimh/asq-toolkit-materials', source: 'NIMH' },
    { name: 'Columbia-Suicide Severity Rating Scale Guide', type: 'Risk Assessment', url: 'https://cssrs.columbia.edu/wp-content/uploads/C-SSRS_Scoring_and_Administration_Guide_2022_03_30.pdf', source: 'Columbia University' },
    { name: 'AFSP Suicide Prevention Toolkit', type: 'Multi-Resource', url: 'https://afsp.org/suicide-prevention-toolkit/', source: 'American Foundation for Suicide Prevention' },
    { name: 'Postvention & Grief Support', type: 'Support Resource', url: 'https://www.afsp.org/find-support/we-can-help/support-after-suicide/', source: 'AFSP' },
  ]},
  { category: 'Resource Directories & Databases', id: 'resource-directories', items: [
    { name: 'SAMHSA Treatment Locator', type: 'Provider Directory', url: 'https://findtreatment.samhsa.gov/', source: 'SAMHSA' },
    { name: 'NAMI Helpline & Resource Center', type: 'Information & Support', url: 'https://www.nami.org/get-involved/awareness-events/mental-health-awareness-month', source: 'NAMI' },
    { name: 'APA Psychologist Locator', type: 'Provider Directory', url: 'https://locator.apa.org/', source: 'American Psychological Association' },
    { name: 'Psychology Today Therapist Finder', type: 'Provider Directory', url: 'https://www.psychologytoday.com/us/basics/therapy', source: 'Psychology Today' },
  ]},
  { category: 'Victim & Survivor Services', id: 'victim-services', items: [
    { name: 'NOVA (National Organization for Victim Assistance)', type: 'Victim Advocacy', url: 'https://www.trynova.org/', source: 'NOVA' },
    { name: 'National Human Trafficking Hotline', type: 'Crisis Intervention', url: 'https://humantraffickinghotline.org/', source: 'Polaris Project', urgent: true },
    { name: 'RAINN (Sexual Assault Hotline)', type: 'Crisis Intervention', url: 'https://www.rainn.org/', source: 'RAINN', urgent: true },
  ]},
  { category: 'Housing & Shelter Resources', id: 'housing-shelter', items: [
    { name: 'HUD Housing Choice Voucher Program', type: 'Housing Assistance', url: 'https://www.hud.gov/program_offices/public_indian_housing/programs/ph/phr/about/fact_sheet', source: 'HUD' },
    { name: 'National Homeless Hotline', type: 'Emergency Shelter', url: 'https://www.homelessshelterdirectory.org/', source: 'Homeless Shelter Directory' },
  ]},
  { category: 'Trauma Education & Training', id: 'trauma-education', items: [
    { name: 'National Child Traumatic Stress Network (NCTSN)', type: 'Training & Research', url: 'https://www.nctsn.org/', source: 'NCTSN' },
    { name: 'Trauma Center (Bessel van der Kolk)', type: 'Training & Research', url: 'https://traumacenter.org/', source: 'Trauma Center' },
  ]},
];

module.exports = { AGENT_RESOURCES };
