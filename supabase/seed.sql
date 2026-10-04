-- Development seed: initial domains. Demo cases live in src/features/cases/demo and are loaded into
-- the database by the Milestone 2 seeding script, so there is one source of truth for demo content.
insert into public.domains (name, slug, domain_type) values
  ('Medical Diagnosis', 'medical-diagnosis', 'medical'),
  ('Materia Medica', 'materia-medica', 'materia_medica'),
  ('Repertory', 'repertory', 'repertory'),
  ('Pathology', 'pathology', 'medical'),
  ('Pharmacology', 'pharmacology', 'medical'),
  ('Anatomy', 'anatomy', 'general'),
  ('Physiology', 'physiology', 'general'),
  ('Pediatrics', 'pediatrics', 'medical'),
  ('Dermatology', 'dermatology', 'medical'),
  ('ENT', 'ent', 'medical'),
  ('Neurology', 'neurology', 'medical'),
  ('Cardiology', 'cardiology', 'medical'),
  ('Respiratory Medicine', 'respiratory-medicine', 'medical'),
  ('Gastroenterology', 'gastroenterology', 'medical'),
  ('Endocrinology', 'endocrinology', 'medical'),
  ('Emergency Medicine', 'emergency-medicine', 'medical'),
  ('Clinical Reasoning', 'clinical-reasoning', 'general')
on conflict (slug) do nothing;
