import { SchemaBuilder, nonEmpty, strArray } from './util.js';

/** DEMO_SPEC_AGENT output schema. */
export const demoSpecSchema = {
  name: 'demo_spec',

  describe() {
    return `{
  "demo_name": string,
  "pages": ["page/screen in the demo build"],
  "features": ["feature to show, tied to the business's problem"],
  "workflow": ["ordered walkthrough steps mirroring the business's real operations"],
  "sample_entities": [{ "name": string, "description": string }],
  "customization_points": ["what would need customizing for this specific business"]
}
Ground everything in the supplied business context; do not invent facts about the business.`;
  },

  validate(data) {
    const b = new SchemaBuilder(this.name);
    if (!b.require(data && typeof data === 'object', 'response must be a JSON object')) return b.result(null);

    if (!b.require(nonEmpty(data.demo_name, 250), 'demo_name required')) return b.result(null);

    const workflow = strArray(data.workflow, { maxItems: 15, maxLen: 400 }) || [];
    if (!b.require(workflow.length > 0, 'workflow must be a non-empty ordered list')) return b.result(null);

    const value = {
      demo_name: String(data.demo_name).slice(0, 250),
      pages: strArray(data.pages) || [],
      features: strArray(data.features) || [],
      workflow,
      sample_entities: [],
      customization_points: strArray(data.customization_points) || [],
    };

    for (const e of Array.isArray(data.sample_entities) ? data.sample_entities : []) {
      if (e && nonEmpty(e.name, 200)) {
        value.sample_entities.push({
          name: String(e.name).slice(0, 200),
          description: nonEmpty(e.description, 500) ? String(e.description).slice(0, 500) : '',
        });
      }
    }

    return b.result(value);
  },
};
