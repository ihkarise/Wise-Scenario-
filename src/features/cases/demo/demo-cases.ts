import type { CaseDefinition } from "@/lib/engine/types";
import { buildDemoCase } from "./build-demo-case";

/**
 * DEMO CONTENT for development and tests only.
 * Every case here is fictional, unreviewed, and carries placeholder references that a reviewer must
 * replace with verified sources. None of it is copied from any other product.
 */

const DEMO_NOTE = "DEMO CONTENT: fictional and not medically reviewed.";

/** Case A: 2 stages, 3 lives, default REVEAL_ANSWER. */
const numbLittleFinger = buildDemoCase({
  slug: "demo-numb-little-finger",
  caseNumber: 1,
  title: "The numb little finger",
  summary: `${DEMO_NOTE} A short anatomy case about a tingling hand.`,
  domain: "Anatomy",
  category: "Upper limb",
  difficulty: "EASY",
  maxLives: 3,
  stages: [
    {
      title: "Presentation",
      content:
        "A 35-year-old office worker has tingling and numbness in his little finger and the inner half of his ring finger. It is worse after long periods leaning on his elbows at his desk.",
      question: "Which nerve is most likely affected?",
      options: ["Median nerve", "*Ulnar nerve", "Radial nerve", "Musculocutaneous nerve"],
    },
    {
      title: "Examination",
      content:
        "He has weakness spreading his fingers apart. When he grips a sheet of paper between his thumb and index finger, the tip of his thumb bends (positive Froment's sign).",
      question: "Which nerve is affected?",
      options: ["*Ulnar nerve", "Anterior interosseous nerve", "Median nerve", "Axillary nerve"],
    },
  ],
  answerLabel: "Ulnar nerve (compression at the elbow)",
  finalExplanation:
    "The ulnar nerve carries sensation from the little finger and the inner half of the ring finger, and supplies most small muscles of the hand, including the interossei that spread the fingers and adductor pollicis. When adductor pollicis is weak, the long thumb flexor compensates and bends the thumb tip: Froment's sign. Leaning on the elbows compresses the nerve where it passes behind the elbow.",
  keyClues: [
    "Sensory loss in the little finger and inner half of the ring finger",
    "Symptoms brought on by pressure on the elbow",
    "Weak finger abduction",
    "Positive Froment's sign",
  ],
  learningPoints: [
    "Map the sensory loss first: it often names the nerve.",
    "Froment's sign tests adductor pollicis, which is supplied by the ulnar nerve.",
  ],
  differentials: [
    { label: "Median nerve", reason: "Affects the thumb, index, middle and half of the ring finger, with thenar weakness." },
    { label: "Radial nerve", reason: "Affects the back of the hand and causes wrist drop, not little-finger numbness." },
    { label: "Anterior interosseous nerve", reason: "Purely motor; causes a weak pinch but no numbness." },
  ],
  placeholderReferences: ["Placeholder: anatomy textbook chapter on the ulnar nerve. Reviewer to add a verified reference."],
});

/** Case B: 5 stages, 5 lives, different option sets (and counts) per stage. */
const ringShapedRash = buildDemoCase({
  slug: "demo-ring-shaped-rash",
  caseNumber: 124,
  title: "The ring-shaped rash",
  summary: `${DEMO_NOTE} A dermatology case revealed over five clues.`,
  domain: "Medical Diagnosis",
  category: "Dermatology",
  difficulty: "INTERMEDIATE",
  maxLives: 5,
  stages: [
    {
      title: "Presentation",
      content: "A 24-year-old man has an itchy rash on his left forearm. It has been slowly getting bigger for three weeks.",
      question: "What is the most likely diagnosis?",
      options: ["Psoriasis", "*Tinea corporis", "Nummular eczema", "Scabies"],
    },
    {
      title: "History",
      content: "He adopted a kitten a month ago. There is a single lesion and nobody at home is itching.",
      question: "What is the most likely diagnosis now?",
      options: ["*Tinea corporis", "Granuloma annulare", "Nummular eczema", "Pityriasis rosea"],
    },
    {
      title: "Examination",
      content: "A 4 cm ring-shaped plaque with a raised, scaly advancing edge and a clearer centre.",
      question: "Which diagnosis fits best?",
      options: ["Granuloma annulare", "*Tinea corporis", "Erythema migrans", "Psoriasis"],
    },
    {
      title: "Treatment so far",
      content: "A steroid cream bought from a pharmacy made it less red for a week, but the ring kept spreading.",
      question: "Which diagnosis fits best?",
      options: ["Nummular eczema", "Granuloma annulare", "*Tinea corporis"],
    },
    {
      title: "Investigation",
      content: "A skin scraping examined with potassium hydroxide (KOH) shows branching, septate hyphae.",
      question: "What is the final diagnosis?",
      options: ["*Tinea corporis", "Erythema migrans", "Granuloma annulare", "Nummular eczema", "Psoriasis"],
    },
  ],
  answerLabel: "Tinea corporis",
  finalExplanation:
    "A single itchy ring-shaped plaque with an active scaly border and central clearing, after contact with a young cat, is the classic picture of a dermatophyte infection of the body skin. Steroid creams can reduce redness while letting the fungus spread. Seeing hyphae on KOH microscopy confirms a fungal cause.",
  keyClues: [
    "Slowly expanding, itchy single lesion",
    "New kitten: a likely animal source",
    "Ring shape with a scaly advancing edge and central clearing",
    "Spread despite a steroid cream",
    "KOH preparation shows fungal hyphae",
  ],
  learningPoints: [
    "Scale at the edge of a ring-shaped lesion should prompt a KOH scraping.",
    "Ask about pets and contact sports in any ring-shaped rash.",
    "Avoid steroid-only creams before ruling out a fungal infection.",
  ],
  differentials: [
    { label: "Granuloma annulare", reason: "Also ring-shaped, but usually not scaly or itchy, and KOH is negative." },
    { label: "Nummular eczema", reason: "Coin-shaped and itchy, but the whole plaque is involved without central clearing." },
    { label: "Psoriasis", reason: "Well-defined plaques with silvery scale, usually on elbows and knees." },
    { label: "Erythema migrans", reason: "Expanding redness after a tick bite, typically without scale." },
  ],
  placeholderReferences: [
    "Placeholder: dermatology textbook chapter on superficial fungal infections. Reviewer to add a verified reference.",
  ],
});

/** Case C: 7 stages, 5 lives, a free first stage (life cost 0). Lives can run out before the last clue. */
const tiredAndCold = buildDemoCase({
  slug: "demo-tired-and-cold",
  caseNumber: 207,
  title: "Tired and always cold",
  summary: `${DEMO_NOTE} A longer endocrine case. The first clue costs no life.`,
  domain: "Medical Diagnosis",
  category: "Endocrinology",
  difficulty: "HARD",
  maxLives: 5,
  stages: [
    {
      title: "Presentation",
      content: "A 38-year-old woman has felt tired for six months. She sleeps enough but never feels rested.",
      question: "What is the most likely diagnosis?",
      options: ["Depression", "Iron-deficiency anaemia", "*Hashimoto thyroiditis", "Obstructive sleep apnoea"],
      lifeCost: 0,
      hint: "This first clue is a free guess: a wrong answer here costs no life.",
    },
    {
      title: "History",
      content: "She has gained 5 kg without eating more, and has become constipated.",
      question: "What is the most likely diagnosis now?",
      options: ["*Hashimoto thyroiditis", "Cushing syndrome", "Depression", "Polycystic ovary syndrome"],
    },
    {
      title: "More history",
      content: "She feels cold when others are comfortable, and her periods have become heavier.",
      question: "What is the most likely diagnosis?",
      options: ["Iron-deficiency anaemia", "Perimenopause", "*Hashimoto thyroiditis", "Uterine fibroids"],
    },
    {
      title: "Examination",
      content: "Her skin is dry, her hair is thinning, and her pulse is 54 per minute.",
      question: "Which diagnosis fits best?",
      options: ["Graves disease", "*Hashimoto thyroiditis", "Addison disease", "Hypopituitarism"],
    },
    {
      title: "Neck and reflexes",
      content: "The relaxation phase of her ankle reflexes is slow. She has a small, firm, painless goitre.",
      question: "Which diagnosis fits best?",
      options: ["Graves disease", "Subacute (de Quervain) thyroiditis", "*Hashimoto thyroiditis", "Multinodular goitre"],
    },
    {
      title: "Thyroid function",
      content: "TSH is raised and free T4 is low.",
      question: "Which diagnosis fits best?",
      options: ["*Hashimoto thyroiditis", "Secondary hypothyroidism", "Subacute (de Quervain) thyroiditis", "Iodine deficiency"],
    },
    {
      title: "Antibodies",
      content: "Anti-thyroid peroxidase (anti-TPO) antibodies are strongly positive.",
      question: "What is the final diagnosis?",
      options: ["Iodine deficiency", "*Hashimoto thyroiditis", "Graves disease", "Postpartum thyroiditis", "Riedel thyroiditis"],
    },
  ],
  answerLabel: "Hashimoto thyroiditis (primary hypothyroidism)",
  finalExplanation:
    "Tiredness, weight gain, constipation, cold intolerance, heavy periods, dry skin, a slow pulse and slow-relaxing reflexes together suggest hypothyroidism. A raised TSH with a low free T4 confirms a primary (thyroid) cause, and a painless firm goitre with positive anti-TPO antibodies points to autoimmune Hashimoto thyroiditis.",
  keyClues: [
    "Tiredness with weight gain and constipation",
    "Cold intolerance and heavier periods",
    "Bradycardia, dry skin, slow-relaxing reflexes",
    "Raised TSH with low free T4",
    "Positive anti-TPO antibodies",
  ],
  learningPoints: [
    "Raised TSH with low free T4 means the thyroid itself is failing (primary hypothyroidism).",
    "In secondary hypothyroidism, TSH is low or inappropriately normal.",
    "A painful goitre suggests subacute thyroiditis rather than Hashimoto thyroiditis.",
  ],
  differentials: [
    { label: "Secondary hypothyroidism", reason: "Pituitary cause: TSH would be low or normal, not raised." },
    { label: "Subacute (de Quervain) thyroiditis", reason: "Painful, tender goitre, often after a viral illness." },
    { label: "Graves disease", reason: "Overactive thyroid: weight loss, heat intolerance, fast pulse." },
    { label: "Depression", reason: "Can cause tiredness, but not bradycardia, goitre or abnormal thyroid tests." },
  ],
  placeholderReferences: [
    "Placeholder: endocrinology guideline on the diagnosis of hypothyroidism. Reviewer to add a verified reference.",
  ],
});

/** Case D: homeopathy / materia medica, 3 stages, 5 lives, RETRY_FINAL_STAGE. */
const stiffOnRising = buildDemoCase({
  slug: "demo-stiff-on-rising",
  caseNumber: 241,
  title: "Stiff on rising",
  summary: `${DEMO_NOTE} A materia medica case that turns on modalities.`,
  domain: "Materia Medica",
  category: "Musculoskeletal",
  difficulty: "EASY",
  // 5 lives over 3 stages so a wrong final answer still leaves lives for a retry.
  maxLives: 5,
  terminalBehavior: "RETRY_FINAL_STAGE",
  stages: [
    {
      title: "Presentation",
      content: "A 45-year-old man has aching, stiff joints after getting soaked in cold rain on a camping trip.",
      question: "Which remedy is most indicated?",
      options: ["Bryonia alba", "*Rhus toxicodendron", "Arnica montana", "Ledum palustre"],
    },
    {
      title: "Modalities",
      content: "The pain is worst when he first moves after resting and eases as he keeps moving.",
      question: "Which remedy fits these modalities?",
      options: ["Bryonia alba", "Causticum", "*Rhus toxicodendron", "Arnica montana"],
    },
    {
      title: "Generals",
      content: "He is restless at night and cannot stay in one position. Warmth helps; cold, damp weather makes it worse.",
      question: "What is the final remedy?",
      options: ["Arsenicum album", "*Rhus toxicodendron", "Bryonia alba"],
    },
  ],
  answerLabel: "Rhus toxicodendron",
  finalExplanation:
    "Stiffness after exposure to cold and wet, worse on beginning to move and better from continued motion, with restlessness and relief from warmth, are keynotes taught for Rhus toxicodendron.",
  keyClues: [
    "Complaints after getting wet and chilled",
    "Worse on first motion, better with continued motion",
    "Restlessness; better from warmth, worse in cold damp weather",
  ],
  learningPoints: [
    "Modalities (what makes a symptom better or worse) often separate similar remedies.",
    "First-motion aggravation with continued-motion relief contrasts with Bryonia, which is worse from any motion.",
  ],
  differentials: [
    { label: "Bryonia alba", reason: "Worse from any motion; better from complete rest and firm pressure." },
    { label: "Arnica montana", reason: "Sore, bruised feeling after injury or overexertion." },
    { label: "Ledum palustre", reason: "Puncture wounds; joint pains better from cold applications." },
    { label: "Arsenicum album", reason: "Anxious restlessness with burning pains, better from warmth." },
  ],
  placeholderReferences: [
    "Placeholder: Boericke, Pocket Manual of Homoeopathic Materia Medica, entry for Rhus toxicodendron. Reviewer to verify edition and page.",
  ],
});

/** Case E: repertory reasoning, 3 stages, 4 lives, END_CASE (fails without revealing the answer on a wrong final pick). */
const sunHeadache = buildDemoCase({
  slug: "demo-headache-from-the-sun",
  caseNumber: 302,
  title: "Headache from the sun",
  summary: `${DEMO_NOTE} Choose the rubric that best expresses the patient's words. Rubric wording to be verified against the chosen repertory.`,
  domain: "Repertory",
  category: "Rubric selection",
  difficulty: "INTERMEDIATE",
  // 4 lives over 3 stages so END_CASE (rather than running out of lives) can end the case.
  maxLives: 4,
  terminalBehavior: "END_CASE",
  stages: [
    {
      title: "Patient's words",
      content: "A patient says: \"My headaches come on whenever I have been out in the sun.\"",
      question: "Which rubric best expresses this symptom?",
      options: ["HEAD - PAIN - warm room", "*HEAD - PAIN - sun, from exposure to", "HEAD - PAIN - light, from", "GENERALS - sun, exposure to"],
    },
    {
      title: "Clarifying the modality",
      content: "Indoors, a hot room or bright lights do not bring the headache on. Only sunshine outdoors does.",
      question: "Which rubric best expresses this symptom?",
      options: ["HEAD - PAIN - light, from", "HEAD - PAIN - heated, from becoming", "*HEAD - PAIN - sun, from exposure to", "HEAD - PAIN - warm room"],
    },
    {
      title: "Location",
      content: "The complaint is confined to the head. She has no other symptoms from being in the sun.",
      question: "Choose the most specific rubric.",
      options: ["GENERALS - sun, exposure to", "*HEAD - PAIN - sun, from exposure to", "HEAD - PAIN"],
    },
  ],
  answerLabel: "HEAD - PAIN - sun, from exposure to",
  finalExplanation:
    "A good rubric matches the location (head), the sensation (pain) and the modality (exposure to the sun) as closely as the patient's words allow. Heat and light rubrics describe different triggers, a general rubric describes the whole person rather than a local complaint, and a bare HEAD - PAIN rubric loses the characteristic modality.",
  keyClues: [
    "Headache triggered by being out in the sun",
    "Not triggered by heat or light indoors",
    "Complaint limited to the head",
  ],
  learningPoints: [
    "Prefer the most specific rubric that still faithfully represents the patient's words.",
    "Check that the modality is the real trigger before choosing a modality rubric.",
  ],
  differentials: [
    { label: "HEAD - PAIN - warm room", reason: "Describes heat indoors, which does not trigger her headache." },
    { label: "HEAD - PAIN - light, from", reason: "Bright light indoors does not trigger it." },
    { label: "GENERALS - sun, exposure to", reason: "A general rubric suits complaints of the whole person, not a local headache." },
  ],
  placeholderReferences: [
    "Placeholder: repertory source for the rubric HEAD - PAIN - sun, from exposure to. Reviewer to verify wording and source.",
  ],
});

/** Unpublished draft used to prove drafts are never playable. */
const unpublishedDraft = buildDemoCase({
  slug: "demo-unpublished-draft",
  caseNumber: 999,
  title: "Unpublished draft",
  summary: `${DEMO_NOTE} A draft that must never be playable by learners.`,
  domain: "Clinical Reasoning",
  category: "Testing",
  difficulty: "EASY",
  maxLives: 3,
  publicationStatus: "DRAFT",
  stages: [
    { title: "Clue one", content: "Draft clue one.", question: "Draft question?", options: ["*Draft answer", "Other"] },
    { title: "Clue two", content: "Draft clue two.", question: "Draft question?", options: ["*Draft answer", "Other"] },
  ],
  answerLabel: "Draft answer",
  finalExplanation: "Draft explanation.",
  keyClues: [],
  learningPoints: [],
  differentials: [],
  placeholderReferences: [],
});

export const DEMO_CASES: readonly CaseDefinition[] = [
  numbLittleFinger,
  ringShapedRash,
  tiredAndCold,
  stiffOnRising,
  sunHeadache,
  unpublishedDraft,
];
