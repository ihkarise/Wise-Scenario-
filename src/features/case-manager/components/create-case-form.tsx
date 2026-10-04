"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/state-views";
import { LIMITS } from "@/features/admin/draft";
import { DIFFICULTY_LABEL } from "@/features/player/labels";
import { DIFFICULTIES, type Difficulty } from "@/lib/engine/types";
import { adminRequest } from "../admin-api";

type Props = {
  domains: { id: string; name: string }[];
  categories: { domainId: string; name: string }[];
  defaultDomainId: string;
  canAddCategory: boolean;
};

export function CreateCaseForm({ domains, categories, defaultDomainId, canAddCategory }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ caseCode: "", title: "", domainId: defaultDomainId, category: "", subcategory: "", difficulty: "INTERMEDIATE" as Difficulty, maxLives: LIMITS.defaultLives as number });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; issues: string[] } | null>(null);
  const domainCategories = useMemo(() => categories.filter((c) => c.domainId === form.domainId), [categories, form.domainId]);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await adminRequest<{ caseId: string }>("/api/admin/cases", { method: "POST", body: { ...form, caseCode: form.caseCode.trim() } });
    if (res.ok) {
      router.push(`/admin/cases/${res.data.caseId}/edit`);
      return;
    }
    setError({ message: res.message, issues: res.issues });
    setBusy(false);
  };

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input id="new-title" label="Title" required maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} hint="Shown to learners. Do not give away the diagnosis." />
          <Input
            id="new-code"
            label="Case ID (optional)"
            maxLength={40}
            placeholder="e.g. CASE-007"
            value={form.caseCode}
            onChange={(e) => set("caseCode", e.target.value)}
            hint="Leave empty to get the next CASE-### number."
          />
          <Select id="new-domain" label="Domain" value={form.domainId} onChange={(e) => set("domainId", e.target.value)}>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <div>
            <Input
              id="new-category"
              label="Category"
              required
              maxLength={80}
              list="new-category-list"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              hint={canAddCategory ? "Choose one or type a new category." : "Choose an existing category."}
            />
            <datalist id="new-category-list">
              {domainCategories.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
          </div>
          <Input id="new-subcategory" label="Subcategory (optional)" maxLength={80} value={form.subcategory} onChange={(e) => set("subcategory", e.target.value)} />
          <Select id="new-difficulty" label="Difficulty" value={form.difficulty} onChange={(e) => set("difficulty", e.target.value as Difficulty)}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABEL[d]}
              </option>
            ))}
          </Select>
          <Input
            id="new-lives"
            type="number"
            label="Starting lives"
            min={LIMITS.minLives}
            max={LIMITS.maxLives}
            value={form.maxLives}
            onChange={(e) => set("maxLives", Number(e.target.value))}
          />
        </div>
        {error && <ErrorState title={error.message} message={error.issues.join(" ") || "Check the fields and try again."} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy} disabled={!form.title.trim() || !form.category.trim()}>
            Create draft and open editor
          </Button>
        </div>
        <p className="text-sm text-ink-muted">The case is created as a draft. Learners cannot see it until a super administrator publishes it.</p>
      </form>
    </Card>
  );
}
