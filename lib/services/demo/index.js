// Concept Demo Generator — builds industry-specific demo specifications from
// reusable templates. Every output is clearly labeled "CONCEPT DEMO" and every
// piece of sample data is fictional and marked as such.

import { DEMO_TEMPLATES, DEMO_TEMPLATE_MAP, INDUSTRY_KEYWORDS } from './templates.js';

// --- Template matching -------------------------------------------------------

function matchTemplateKey(solution, business) {
  // 1. Business industry keyword match — the demo is shown TO the business, so
  //    their industry determines the template (a furniture shop gets furniture demo
  //    even if the solution is e-commerce).
  const bizText = [business?.industry, business?.description, business?.name]
    .filter(Boolean).join(' ').toLowerCase();
  if (bizText) {
    for (const [key, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
      if (keywords.some((kw) => bizText.includes(kw))) return key;
    }
  }

  // 2. Solution slug mapping (fallback when business industry is unknown).
  const slug = solution?.demo_template || null;
  if (slug && DEMO_TEMPLATE_MAP[slug]) return DEMO_TEMPLATE_MAP[slug];

  // 3. Solution name/description keyword match.
  const solText = [solution?.name, solution?.description].filter(Boolean).join(' ').toLowerCase();
  if (solText) {
    for (const [key, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
      if (keywords.some((kw) => solText.includes(kw))) return key;
    }
  }

  return null;
}

// --- Spec building -----------------------------------------------------------

function buildDemoSpec(template, business, opportunity, solution) {
  const bizName = business?.name || 'The Business';
  const industry = template.label;

  // Filter features to those relevant to the solution's problem types.
  const problemTypes = solution?.solves_problem_types || [];
  const relevantFeatures = selectFeatures(template.features, problemTypes, solution?.features);

  // Build a problem-specific workflow: keep the generic steps but prefix with
  // context from the opportunity's explanation.
  const workflow = buildWorkflow(template.workflow, opportunity, bizName);

  return {
    _concept: true,
    _note: 'This is a CONCEPT DEMO — a design specification, not the prospect\'s existing system. All sample data is fictional.',

    demo_name: `Concept Demo — ${industry} for ${bizName}`,
    industry,
    business_name: bizName,

    problem_addressed: formatProblem(opportunity),
    recommended_solution: solution?.name || 'Custom software',

    pages: template.pages,
    features: relevantFeatures,
    workflow,
    sample_data: labelSampleData(template.sample_data, bizName),
    data_structure: buildDataStructure(template.sample_data),
    customization_points: [
      `Populate with ${bizName}'s actual data (products, customers, pricing)`,
      ...template.customization_points,
    ],
  };
}

// --- Helpers -----------------------------------------------------------------

function selectFeatures(templateFeatures, problemTypes, solutionFeatures) {
  const features = [...templateFeatures];

  // Append solution-specific features that are not already covered by the template.
  if (Array.isArray(solutionFeatures)) {
    for (const f of solutionFeatures) {
      const text = String(f).trim();
      if (!text) continue;
      // Skip features that are already conceptually covered by the template.
      const isCovered = features.some((existing) => {
        const e = existing.toLowerCase();
        const t = text.toLowerCase();
        return e.includes(t) || t.includes(e);
      });
      if (!isCovered) features.push(text);
    }
  }

  return features;
}

function buildWorkflow(templateWorkflow, opportunity, bizName) {
  const explanation = opportunity?.opportunity_explanation || {};
  const why = explanation.why_exists || '';
  const impact = explanation.money_impact || '';

  // Prepend a contextual opener if we have the explanation.
  const opener = why
    ? `Context for the demo: ${why.slice(0, 200)}`
    : `Walk through ${bizName}'s key workflow end to end.`;

  return [opener, ...templateWorkflow];
}

function formatProblem(opportunity) {
  if (!opportunity) return 'General operational improvement';
  const problemType = String(opportunity.problem_type || '').replaceAll('_', ' ');
  const explanation = opportunity.opportunity_explanation || {};
  const why = explanation.why_exists || '';
  if (why) return `${problemType}: ${why.slice(0, 300)}`;
  return problemType || 'General operational improvement';
}

function labelSampleData(sampleData, bizName) {
  if (!sampleData) return [];
  const entries = [];
  for (const [entity, records] of Object.entries(sampleData)) {
    if (!Array.isArray(records)) continue;
    entries.push({
      entity,
      label: `Sample ${entity} (fictional data representing a typical day at ${bizName})`,
      records,
    });
  }
  return entries;
}

function buildDataStructure(sampleData) {
  if (!sampleData) return [];
  const structures = [];
  for (const [entity, records] of Object.entries(sampleData)) {
    if (!Array.isArray(records) || records.length === 0) continue;
    const sample = records[0];
    const fields = Object.keys(sample).map((key) => ({
      field: key,
      type: inferFieldType(sample[key]),
    }));
    structures.push({ entity, fields });
  }
  return structures;
}

function inferFieldType(value) {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
    if (/^\+\d{10,}/.test(value)) return 'phone';
    if (/KES|USD|EUR|GBP/.test(value)) return 'currency';
  }
  return 'string';
}

// --- Public API --------------------------------------------------------------

export function generateDemoSpec({ business, opportunity, solution }) {
  const key = matchTemplateKey(solution, business);
  const template = key ? DEMO_TEMPLATES[key] : null;

  if (!template) {
    // No template matched — fall back to a minimal generic spec.
    return buildGenericSpec(business, opportunity, solution);
  }

  return buildDemoSpec(template, business, opportunity, solution);
}

function buildGenericSpec(business, opportunity, solution) {
  const bizName = business?.name || 'The Business';
  return {
    _concept: true,
    _note: 'This is a CONCEPT DEMO — a design specification, not the prospect\'s existing system. All sample data is fictional. No industry-specific template was available; customize this spec for the business.',

    demo_name: `Concept Demo — ${solution?.name || 'Software'} for ${bizName}`,
    industry: business?.industry || 'General',
    business_name: bizName,

    problem_addressed: formatProblem(opportunity),
    recommended_solution: solution?.name || 'Custom software',

    pages: [
      { name: 'Dashboard', description: 'Overview: key metrics, pending items, recent activity' },
      { name: 'Core Workflow', description: 'Main screen for the primary business process' },
      { name: 'Customers / Contacts', description: 'Customer or contact management' },
      { name: 'Reports', description: 'Key reports and summaries' },
    ],
    features: [
      ...(Array.isArray(solution?.features) ? solution.features : []),
      'Dashboard with key business metrics',
      'Mobile-friendly interface',
      'Reporting and export',
    ],
    workflow: [
      `Context: ${formatProblem(opportunity)}`,
      'Open Dashboard — review key metrics and pending items',
      'Walk through the core workflow end to end',
      'Show reporting and owner view',
      'Discuss setup, training, and timeline',
    ],
    sample_data: [
      { entity: 'sample_records', label: `Clearly fictional example data representing a typical day at ${bizName}`, records: [] },
    ],
    data_structure: [],
    customization_points: [
      `Populate with ${bizName}'s actual data`,
      'Configure workflows to match their process',
      'Add their branding (logo, colours, name)',
      'Configure reports around their key metrics',
    ],
  };
}

export function listTemplateIndustries() {
  return Object.values(DEMO_TEMPLATES).map((t) => ({
    key: t.industry,
    label: t.label,
    page_count: t.pages.length,
    feature_count: t.features.length,
  }));
}
