/**
 * Provider contracts for the Discovery & Research Engine.
 *
 * COMPLIANCE RULES (binding for every implementation):
 *  - never bypass authentication, CAPTCHAs, access controls or platform restrictions
 *  - respect robots.txt where applicable
 *  - respect rate limits; stay well within polite fetch intervals
 *  - use only legitimate public sources and supported/provider APIs
 *
 * Platform APIs (TikTok, Instagram, etc.) are NOT scraped directly. Social data
 * enters only through a configured supported provider (DISCOVERY_API_URL) or a
 * licensed social feed (SOCIAL_MEDIA_FEED_URL).
 */

/**
 * @typedef {Object} DiscoveryProvider
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {(filters: SearchFilters) => Promise<Array<Candidate>>} search
 *
 * @typedef {Object} SearchFilters
 * @property {string} query          free-text keywords
 * @property {string} [industry]
 * @property {string} [location]
 * @property {string} [platform]     e.g. tiktok | instagram | facebook | web
 * @property {number} [minimumAudience]
 * @property {string} [businessMaturity] any|small|established|mature
 * @property {string[]} [problemCategories]
 * @property {string} [requiredContactType] email|phone|whatsapp|social
 *
 * @typedef {Object} Candidate
 * @property {string} name
 * @property {string} [industry]
 * @property {string} [description]
 * @property {string} [location]
 * @property {string} [country]
 * @property {string} [website]
 * @property {string} [socialUrl]      public social profile URL
 * @property {string} [platform]
 * @property {number} [audience]       follower count ONLY when the source publishes it
 * @property {string} [phone]
 * @property {string} [email]
 * @property {{value:string, contactType?:string, whatsappConfirmed?:boolean,
 *             sourceUrl?:string, confidence?:number}[]} [contacts]
 * @property {{text:string, claimType?:'FACT'|'HYPOTHESIS', signalKey?:string,
 *             sourceUrl?:string, sourceName?:string, confidence?:number}[]} [evidence]
 * @property {{source_type:string, source_name:string, source_url?:string,
 *             external_identifier?:string}} source
 */

/**
 * @typedef {Object} BusinessResearchProvider
 * @property {string} id
 * @property {string} label
 * @property {async ({ business, evidenceRepo }) => Promise<ResearchFinding[]>} research
 *
 * ResearchFinding: { signalKey?, evidenceType, claimType, text, excerptSummary?,
 *                    sourceName, sourceUrl?, confidence }
 */

/**
 * @typedef {Object} ContactProvider
 * @property {string} id
 * @property {async (candidate: Candidate) => Promise<NormalizedContact[]>} extract
 *
 * NormalizedContact: { contactType, contactValue, isPublic, verificationStatus,
 *                      confidenceScore, sourceUrl? }
 * CONTACT RULES enforced here:
 *   - source explicitly says WhatsApp  -> 'verified_public_whatsapp'
 *   - phone without confirmed WhatsApp -> 'phone_only'
 *   - PHONE_ONLY is NEVER converted to WhatsApp automatically
 */
