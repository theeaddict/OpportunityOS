-- Widen search_queries.business_maturity: it was VARCHAR(8) while its CHECK
-- constraint admits 'established' (11 chars), so real discovery runs 500'd
-- with "value too long for type character varying(8)".

ALTER TABLE search_queries ALTER COLUMN business_maturity TYPE VARCHAR(16);
