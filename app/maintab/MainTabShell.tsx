"use client";

import { type DragEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  CustomerContext,
  type AppState, type ChangeEntry, type CustomerId, type CustomerProfile,
  type CustomerUpdatedMap, type FinancialInfo, type RiskResult, type RrttlluInfo,
  type SmartExtractionPayload, type StoredCustomerState,
  buildStructuredJsonPayload, calculateRiskResult,
  completion, customerRowsToStoredState, customerRowsToUpdatedMap, customerStorage,
  customerTabLabel, defaultCustomerProfiles, createInitialCustomerData, createInitialState,
  createNewCustomerProfile, expectedReturnDisplay, fieldGroups, formatChangeDate,
  formatUpdatedAt, getStoredSelectedCustomerId, irregularIncomeDisplay,
  noLegalConstraint, noneExperience, nullableText, riskExperienceOptions,
  returnOptions, saveCustomerDataJsonOnly, saveCustomerProfileColumns,
  selectedCustomerStorageKey, storeSelectedCustomerId, workspaceTabs,
} from "./CustomerContext";

const tabPaths: Record<string, string> = {
  profile:  "/maintab/tab1",
  existing: "/maintab/tab2",
  create:   "/maintab/tab3",
  compare:  "/maintab/tab4",
};


export default function MainTabShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [customerProfiles, setCustomerProfiles] = useState<CustomerProfile[]>(defaultCustomerProfiles);
  const [customerData, setCustomerData] = useState<Record<CustomerId, AppState>>(() => createInitialCustomerData(defaultCustomerProfiles));
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerId>(defaultCustomerProfiles[0].id);
  const [showCustomerTabs, setShowCustomerTabs] = useState(false);
  const [draggedCustomerId, setDraggedCustomerId] = useState<CustomerId | null>(null);
  const [customerDropIndex, setCustomerDropIndex] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [persistedCustomerIds, setPersistedCustomerIds] = useState<CustomerId[]>([]);
  const [customerUpdatedAt, setCustomerUpdatedAt] = useState<CustomerUpdatedMap>({});
  const [dirtyCustomerData, setDirtyCustomerData] = useState<Record<CustomerId, boolean>>({});
  const [storageErrorMessage, setStorageErrorMessage] = useState("");
  const [analysisRequested, setAnalysisRequested] = useState(false);
  const [confirmedRiskResult, setConfirmedRiskResult] = useState<RiskResult | null>(null);
  const [lastAnalysisSnapshot, setLastAnalysisSnapshot] = useState<ReturnType<typeof buildStructuredJsonPayload> | null>(null);
  const [changeHistory, setChangeHistory] = useState<ChangeEntry[]>([]);
  const [changeHistoryExpanded, setChangeHistoryExpanded] = useState(false);
  const formData = customerData[selectedCustomer] ?? createInitialState();
  const selectedCustomerProfile = customerProfiles.find((c) => c.id === selectedCustomer) ?? customerProfiles[0];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const selectedRows = await customerStorage.selectRows();
      if (cancelled) return;
      if (!selectedRows) { setStorageErrorMessage("Supabase 환경변수가 설정되지 않아 고객 데이터를 불러올 수 없습니다."); setStorageReady(true); return; }
      if (selectedRows.errorMessage) {
        setStorageErrorMessage(selectedRows.errorMessage);
        setCustomerProfiles(defaultCustomerProfiles);
        setCustomerData(createInitialCustomerData(defaultCustomerProfiles));
        setSelectedCustomer(defaultCustomerProfiles[0].id);
        setStorageReady(true);
        return;
      }
      let rows = selectedRows.rows;
      if (!rows.length) {
        setIsSeeding(true);
        const defaultState: StoredCustomerState = { customerProfiles: defaultCustomerProfiles, customerData: createInitialCustomerData(defaultCustomerProfiles), selectedCustomer: defaultCustomerProfiles[0].id };
        const seedResult = await customerStorage.insertDefaults(defaultState);
        if (cancelled) return;
        if (!seedResult.ok) { setStorageErrorMessage(seedResult.message); setIsSeeding(false); setStorageReady(true); return; }
        const seededRows = await customerStorage.selectRows();
        if (cancelled) return;
        if (!seededRows || seededRows.errorMessage) { setStorageErrorMessage(seededRows?.errorMessage ?? "재조회 실패"); setIsSeeding(false); setStorageReady(true); return; }
        rows = seededRows.rows;
      }
      const storedState = rows.length ? customerRowsToStoredState(rows) : null;
      if (storedState) {
        const storedId = getStoredSelectedCustomerId();
        const nextId = storedId && storedState.customerProfiles.some((p) => p.id === storedId) ? storedId : storedState.selectedCustomer;
        setCustomerProfiles(storedState.customerProfiles);
        setCustomerData(storedState.customerData);
        setSelectedCustomer(nextId);
        storeSelectedCustomerId(nextId);
        setPersistedCustomerIds(rows.map((r) => r.id));
        setCustomerUpdatedAt(customerRowsToUpdatedMap(rows));
      }
      setIsSeeding(false);
      setStorageErrorMessage("");
      setStorageReady(true);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const riskResult = useMemo(() => calculateRiskResult(formData.rrttllu), [formData.rrttllu]);

  const financialCompletion = useMemo(() => completion([
    formData.financial.totalAssets, formData.financial.financialAssets, formData.financial.realEstate,
    formData.financial.debt, formData.financial.annualFixedIncome,
    formData.financial.irregularIncomeNone ? "없음" : formData.financial.irregularIncome,
    formData.financial.investableAssets,
    formData.financial.monthlyFixedExpense,
  ]), [formData.financial]);

  const rrttlluCompletion = useMemo(() => {
    const r = formData.rrttllu;
    return completion([r.returnObjective, r.expectedReturnUnknown ? "unknown" : r.expectedReturn, r.investmentExperience.length ? "selected" : "", r.knowledgeLevel, r.derivativesExperience, r.financialAssetRatio, r.investmentAssetRatio, r.riskAttitude, r.lossResponse, r.timeHorizon, r.expectedInterestIncome, r.expectedDividendIncome, r.giftingPlan, r.globalTaxImportance, r.recentGlobalTaxSubject, r.foreignStockTaxImportance, r.regularCashflowNeed, r.lumpSumPlan, r.emergencyReservePlan, r.legalConstraints.length ? "selected" : "", r.preferredAssets, r.avoidedAssets, r.holdingOrDisposalPlan, r.uniqueOther]);
  }, [formData.rrttllu]);

  const internalJsonPayload = useMemo(() => buildStructuredJsonPayload(formData, confirmedRiskResult ?? riskResult, selectedCustomerProfile), [confirmedRiskResult, formData, riskResult, selectedCustomerProfile]);
  const warnings = internalJsonPayload.rrttllu.warnings;
  const customerDataJsonPayload = useMemo(() => ({ appState: formData, analysis: { riskResult, internalJsonPayload, financialCompletion, rrttlluCompletion } }), [financialCompletion, formData, internalJsonPayload, riskResult, rrttlluCompletion]);

  useEffect(() => {
    if (!storageReady || isSeeding || !persistedCustomerIds.includes(selectedCustomer)) return;
    if (!dirtyCustomerData[selectedCustomer]) return;
    void saveCustomerDataJsonOnly(selectedCustomer, customerDataJsonPayload).then((r) => {
      if (!r.ok) setStorageErrorMessage(r.message);
      else {
        setDirtyCustomerData((prev) => ({ ...prev, [selectedCustomer]: false }));
        setStorageErrorMessage("");
      }
    });
  }, [customerDataJsonPayload, dirtyCustomerData, isSeeding, persistedCustomerIds, selectedCustomer, storageReady]);

  const markUpdated = (id: CustomerId, ts = Date.now()) => setCustomerUpdatedAt((prev) => ({ ...prev, [id]: ts }));

  const setFormData = (updater: (current: AppState) => AppState) => {
    markUpdated(selectedCustomer);
    setDirtyCustomerData((prev) => ({ ...prev, [selectedCustomer]: true }));
    setCustomerData((prev) => ({ ...prev, [selectedCustomer]: updater(prev[selectedCustomer] ?? createInitialState()) }));
  };

  const selectCustomer = (id: CustomerId) => {
    setSelectedCustomer(id); storeSelectedCustomerId(id);
    setAnalysisRequested(false); setConfirmedRiskResult(null); setLastAnalysisSnapshot(null);
    setChangeHistory([]); setChangeHistoryExpanded(false);
  };

  const resetSelectedCustomer = () => {
    if (window.confirm("현재 고객만 초기화하시겠습니까?")) {
      markUpdated(selectedCustomer);
      setDirtyCustomerData((prev) => ({ ...prev, [selectedCustomer]: true }));
      setCustomerData((prev) => ({ ...prev, [selectedCustomer]: createInitialState() }));
    } else if (window.confirm("전체 고객을 초기화하시겠습니까?")) {
      const ts = Date.now();
      setCustomerUpdatedAt(Object.fromEntries(customerProfiles.map((p) => [p.id, ts])));
      setDirtyCustomerData(Object.fromEntries(customerProfiles.map((p) => [p.id, true])));
      setCustomerData(createInitialCustomerData(customerProfiles));
      setSelectedCustomer(customerProfiles[0]?.id ?? defaultCustomerProfiles[0].id);
    }
    setAnalysisRequested(false); setConfirmedRiskResult(null); setLastAnalysisSnapshot(null);
    setChangeHistory([]); setChangeHistoryExpanded(false);
  };

  const resetSelectedCustomerInputs = () => {
    markUpdated(selectedCustomer);
    setDirtyCustomerData((prev) => ({ ...prev, [selectedCustomer]: true }));
    setCustomerData((prev) => ({ ...prev, [selectedCustomer]: createInitialState() }));
    setAnalysisRequested(false); setConfirmedRiskResult(null); setLastAnalysisSnapshot(null);
    setChangeHistory([]); setChangeHistoryExpanded(false);
  };

  const addCustomer = () => {
    const profile = createNewCustomerProfile();
    const newState = createInitialState();
    setCustomerProfiles((prev) => [...prev, profile]);
    setCustomerData((prev) => ({ ...prev, [profile.id]: newState }));
    markUpdated(profile.id);
    void customerStorage.insertCustomer(profile, newState, customerProfiles.length).then((r) => {
      if (!r.ok) setStorageErrorMessage(r.message);
      else { setPersistedCustomerIds((prev) => (prev.includes(profile.id) ? prev : [...prev, profile.id])); setStorageErrorMessage(""); }
    });
    selectCustomer(profile.id);
  };

  const reorderCustomer = (dropIndex: number) => {
    if (!draggedCustomerId) return;
    setCustomerProfiles((prev) => {
      const srcIdx = prev.findIndex((p) => p.id === draggedCustomerId);
      if (srcIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(srcIdx, 1);
      const adjusted = srcIdx < dropIndex ? dropIndex - 1 : dropIndex;
      next.splice(Math.max(0, Math.min(adjusted, next.length)), 0, moved);
      return next;
    });
    setDraggedCustomerId(null); setCustomerDropIndex(null);
  };

  const deleteSelectedCustomer = () => {
    const remaining = customerProfiles.filter((p) => p.id !== selectedCustomer);
    const nextProfiles = remaining.length ? remaining : [createNewCustomerProfile()];
    const nextId = nextProfiles[0].id;
    setCustomerProfiles(nextProfiles);
    setCustomerData((prev) => { const next = { ...prev }; delete next[selectedCustomer]; if (!next[nextId]) next[nextId] = createInitialState(); return next; });
    void customerStorage.remove(selectedCustomer).then((r) => {
      if (!r.ok) setStorageErrorMessage(r.message);
      else { setPersistedCustomerIds((prev) => prev.filter((id) => id !== selectedCustomer)); setCustomerUpdatedAt((prev) => { const next = { ...prev }; delete next[selectedCustomer]; return next; }); setStorageErrorMessage(""); }
    });
    selectCustomer(nextId); setDeleteConfirmOpen(false);
  };

  const updateCustomerField = (customerId: CustomerId, field: keyof Pick<CustomerProfile, "name" | "gender" | "birth_year" | "age" | "job">, value: string) => {
    const idx = customerProfiles.findIndex((p) => p.id === customerId);
    const current = customerProfiles[idx];
    if (!current) return;
    const updated: CustomerProfile = { ...current, [field]: value, birthYear: field === "birth_year" ? value : current.birthYear, birth_year: field === "birth_year" ? value : current.birth_year, sort_order: idx };
    setCustomerProfiles(customerProfiles.map((p) => (p.id === customerId ? updated : p)));
    markUpdated(updated.id);
    if (!storageReady || isSeeding) return;
    void saveCustomerProfileColumns(updated).then((r) => {
      if (!r.ok) setStorageErrorMessage(r.message);
      else { setPersistedCustomerIds((prev) => (prev.includes(updated.id) ? prev : [...prev, updated.id])); setStorageErrorMessage(""); }
    });
  };

  const updateCustomerProfile = (key: keyof Omit<CustomerProfile, "id">, value: string) => {
    const field = key === "birthYear" ? "birth_year" : key;
    if (field === "name" || field === "gender" || field === "birth_year" || field === "age" || field === "job") updateCustomerField(selectedCustomer, field, value);
  };

  const hasExtractedText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  const mergeExtractedText = <T extends object>(base: T, patch: Partial<T>, keys: (keyof T)[]) => {
    const next = { ...base };
    keys.forEach((key) => {
      const value = patch[key];
      if (hasExtractedText(value)) (next as Record<keyof T, unknown>)[key] = value;
    });
    return next;
  };

  const uniqueOtherMeaningKey = (value: string) => {
    const compact = value.replace(/\s+/g, "");
    if (/크게흔들리지않|민감하지않|예민하지않/.test(compact)) return "market-stable";
    if (/빠르지않|급하지않|속도가빠르지않/.test(compact)) return "not-fast-decision";
    if (/시장뉴스|단기이슈|뉴스.*민감|민감.*뉴스|민감하게반응/.test(compact)) return "market-sensitivity";
    if (/의사결정.*빠|빠른편|성격.*급|급함|속도가빠/.test(compact)) return "fast-decision";
    if (/배우자|가족.*의사결정|의사결정.*영향력/.test(compact)) return "family-influence";
    if (/질문.*많|충분한설명|설명.*선호|납득/.test(compact)) return "explanation-preference";
    if (/꼼꼼|의심|객관적근거|근거중시/.test(compact)) return "evidence-seeking";
    if (/부모님|부모관련|고령부모/.test(compact)) return "parent-related";
    if (/포트폴리오.*부진|벤치마크.*낮|수익률.*훼손|망가진/.test(compact)) return "portfolio-underperformance";
    if (/급등주|과도한레버리지|레버리지.*손실|손실경험/.test(compact)) return "aggressive-loss-experience";
    if (/모니터링|관리시간|본업이바빠|주도주편입/.test(compact)) return "monitoring-time";
    if (/기존PB|PB서비스|불만족/.test(compact)) return "pb-experience";
    return compact.replace(/[^\p{Script=Hangul}a-zA-Z0-9]/gu, "").slice(0, 32);
  };

  const mergeUniqueOther = (existing: string, incoming: string) => {
    const values = [
      ...incoming.split(/\n/),
      ...existing.split(/\n/),
    ].map((value) => value.trim()).filter(Boolean);
    const byMeaning = new Map<string, string>();
    values.forEach((value) => {
      const key = uniqueOtherMeaningKey(value);
      if (!byMeaning.has(key)) byMeaning.set(key, value);
    });
    return Array.from(byMeaning.values()).join("\n");
  };

  const applySmartExtraction = (payload: SmartExtractionPayload) => {
    const profilePatch = payload.profile ?? {};
    const currentProfile = customerProfiles.find((p) => p.id === selectedCustomer);
    if (!currentProfile) return;

    const updatedProfile: CustomerProfile = {
      ...currentProfile,
      name: hasExtractedText(profilePatch.name) ? profilePatch.name : currentProfile.name,
      gender: hasExtractedText(profilePatch.gender) ? profilePatch.gender : currentProfile.gender,
      birthYear: hasExtractedText(profilePatch.birth_year ?? profilePatch.birthYear) ? (profilePatch.birth_year ?? profilePatch.birthYear ?? "") : currentProfile.birthYear,
      birth_year: hasExtractedText(profilePatch.birth_year ?? profilePatch.birthYear) ? (profilePatch.birth_year ?? profilePatch.birthYear ?? "") : currentProfile.birth_year,
      age: hasExtractedText(profilePatch.age) ? profilePatch.age : currentProfile.age,
      job: hasExtractedText(profilePatch.job) ? profilePatch.job : currentProfile.job,
      sort_order: customerProfiles.findIndex((p) => p.id === selectedCustomer),
    };

    markUpdated(selectedCustomer);
    setCustomerProfiles((prev) => prev.map((p) => (p.id === selectedCustomer ? updatedProfile : p)));
    setDirtyCustomerData((prev) => ({ ...prev, [selectedCustomer]: true }));
    setCustomerData((prev) => {
      const current = prev[selectedCustomer] ?? createInitialState();
      const financialPatch = payload.financial ?? {};
      const rrttlluPatch = payload.rrttllu ?? {};
      const financial = mergeExtractedText(current.financial, financialPatch, [
        "totalAssets", "financialAssets", "realEstate", "debt", "annualFixedIncome", "irregularIncome", "investableAssets", "monthlyFixedExpense",
      ]);
      if (financialPatch.irregularIncomeNone === true) {
        financial.irregularIncomeNone = true;
        financial.irregularIncome = "";
      } else if (hasExtractedText(financialPatch.irregularIncome)) {
        financial.irregularIncomeNone = false;
      }

      const rrttllu = mergeExtractedText(current.rrttllu, rrttlluPatch, [
        "returnObjective", "expectedReturn", "knowledgeLevel", "derivativesExperience", "financialAssetRatio",
        "investmentAssetRatio", "riskAttitude", "lossResponse", "timeHorizon", "giftingPlan", "globalTaxImportance",
        "recentGlobalTaxSubject", "foreignStockTaxImportance", "regularCashflowNeed", "lumpSumPlan",
        "emergencyReservePlan", "legalConstraintOther", "preferredAssets", "avoidedAssets", "holdingOrDisposalPlan",
      ]);
      const manualUniqueOther = current.uniqueOtherManual ?? "";
      const nextSmartUniqueOther = hasExtractedText(rrttlluPatch.uniqueOther) ? rrttlluPatch.uniqueOther : "";
      rrttllu.uniqueOther = nextSmartUniqueOther
        ? mergeUniqueOther(manualUniqueOther, nextSmartUniqueOther)
        : manualUniqueOther;
      if (Array.isArray(rrttlluPatch.investmentExperience) && rrttlluPatch.investmentExperience.length) {
        rrttllu.investmentExperience = rrttlluPatch.investmentExperience;
      }
      if (Array.isArray(rrttlluPatch.legalConstraints) && rrttlluPatch.legalConstraints.length) {
        rrttllu.legalConstraints = rrttlluPatch.legalConstraints;
      }
      if (rrttlluPatch.expectedReturnUnknown === true) {
        rrttllu.expectedReturnUnknown = true;
        rrttllu.expectedReturn = "";
      } else if (hasExtractedText(rrttlluPatch.expectedReturn)) {
        rrttllu.expectedReturnUnknown = false;
      }
      return { ...prev, [selectedCustomer]: { ...current, financial, rrttllu, smartExtractedUniqueOther: nextSmartUniqueOther } };
    });
    if (storageReady && !isSeeding) {
      void saveCustomerProfileColumns(updatedProfile).then((r) => {
        if (!r.ok) setStorageErrorMessage(r.message);
        else setStorageErrorMessage("");
      });
    }
  };

  const setFinancial = (key: keyof FinancialInfo, value: string) => setFormData((prev) => ({ ...prev, financial: { ...prev.financial, [key]: value } }));
  const setRrttllu = (key: keyof RrttlluInfo, value: string) => setFormData((prev) => (
    key === "uniqueOther"
      ? { ...prev, uniqueOtherManual: value, smartExtractedUniqueOther: "", rrttllu: { ...prev.rrttllu, uniqueOther: value } }
      : { ...prev, rrttllu: { ...prev.rrttllu, [key]: value } }
  ));
  const setSmartInputNote = (value: string) => setFormData((prev) => ({ ...prev, smartInputNote: value }));
  const setAiGuidePbNote = (checkpointId: string, value: string) => setFormData((prev) => ({
    ...prev,
    aiGuidePbNotes: { ...(prev.aiGuidePbNotes ?? {}), [checkpointId]: value },
  }));
  const setIrregularIncome = (value: string) => setFormData((prev) => ({ ...prev, financial: { ...prev.financial, irregularIncome: value, irregularIncomeNone: false } }));
  const toggleNoIrregularIncome = () => setFormData((prev) => ({ ...prev, financial: { ...prev.financial, irregularIncome: "", irregularIncomeNone: !prev.financial.irregularIncomeNone } }));
  const setExpectedReturn = (value: string) => setFormData((prev) => ({ ...prev, rrttllu: { ...prev.rrttllu, expectedReturn: value, expectedReturnUnknown: false } }));
  const toggleExpectedReturnUnknown = () => setFormData((prev) => ({ ...prev, rrttllu: { ...prev.rrttllu, expectedReturn: "", expectedReturnUnknown: !prev.rrttllu.expectedReturnUnknown } }));

  const toggleInvestmentExperience = (option: string) => setFormData((prev) => {
    const current = prev.rrttllu.investmentExperience;
    const next = option === noneExperience ? (current.includes(option) ? [] : [option]) : current.includes(option) ? current.filter((x) => x !== option) : [...current.filter((x) => x !== noneExperience), option];
    return { ...prev, rrttllu: { ...prev.rrttllu, investmentExperience: next } };
  });

  const toggleLegalConstraint = (option: string) => setFormData((prev) => {
    const current = prev.rrttllu.legalConstraints;
    const next = option === noLegalConstraint ? (current.includes(option) ? [] : [option]) : current.includes(option) ? current.filter((x) => x !== option) : [...current.filter((x) => x !== noLegalConstraint), option];
    return { ...prev, rrttllu: { ...prev.rrttllu, legalConstraints: next, legalConstraintOther: next.includes("기타") ? prev.rrttllu.legalConstraintOther : "" } };
  });

  const analyzeRrttllu = () => {
    const latestPayload = buildStructuredJsonPayload(formData, riskResult);
    const changes = lastAnalysisSnapshot ? diffPayload(lastAnalysisSnapshot, latestPayload) : [];
    setAnalysisRequested(true); setConfirmedRiskResult(riskResult); setLastAnalysisSnapshot(latestPayload);
    setChangeHistory(changes); setChangeHistoryExpanded(false);
  };

  const contextValue = {
    formData, selectedCustomerProfile, customerProfiles, selectedCustomer,
    riskResult, financialCompletion, rrttlluCompletion, internalJsonPayload, warnings,
    analysisRequested, confirmedRiskResult, changeHistory, changeHistoryExpanded,
    setFinancial, setRrttllu, setIrregularIncome, toggleNoIrregularIncome, setExpectedReturn,
    toggleExpectedReturnUnknown, toggleInvestmentExperience, toggleLegalConstraint, setSmartInputNote, setAiGuidePbNote,
    analyzeRrttllu, resetSelectedCustomer, resetSelectedCustomerInputs, applySmartExtraction,
    updateCustomerProfile, setChangeHistoryExpanded,
  };

  return (
    <CustomerContext.Provider value={contextValue}>
      <main className="min-h-screen px-5 py-6 text-ink lg:px-8">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-5">
          <CustomerSelector
            customers={customerProfiles} selectedCustomer={selectedCustomer}
            showCustomers={showCustomerTabs} onToggleSearch={() => setShowCustomerTabs((p) => !p)}
            onSelectCustomer={selectCustomer} onAddCustomer={addCustomer}
            onRequestDelete={() => setDeleteConfirmOpen(true)}
            onDragStartCustomer={setDraggedCustomerId} draggedCustomerId={draggedCustomerId}
            dropIndex={customerDropIndex} onSetDropIndex={setCustomerDropIndex}
            onDropCustomer={reorderCustomer} recentUpdatedAt={customerUpdatedAt[selectedCustomer] ?? 0}
            storageErrorMessage={storageErrorMessage}
          />
          <div className="flex flex-col gap-5 xl:flex-row">
            <TabStrip onNavigate={(id) => router.push(tabPaths[id])} />
            <section className="min-w-0 flex-1">
              <div className="flex flex-col gap-5">
                {children}
              </div>
            </section>
          </div>
        </div>
        {deleteConfirmOpen ? (
          <DeleteCustomerDialog
            customerLabel={selectedCustomerProfile ? customerTabLabel(selectedCustomerProfile) : "현재 고객"}
            onCancel={() => setDeleteConfirmOpen(false)}
            onDelete={deleteSelectedCustomer}
          />
        ) : null}
      </main>
    </CustomerContext.Provider>
  );
}

const segmentToTab: Record<string, string> = {
  tab1: "profile",
  tab2: "existing",
  tab3: "create",
  tab4: "compare",
};

function TabStrip({ onNavigate }: { onNavigate: (id: string) => void }) {
  const segment = useSelectedLayoutSegment();
  const activeTab = (segment ? segmentToTab[segment] : null) ?? "profile";

  return (
    <nav className="grid shrink-0 gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-soft sm:grid-cols-2 xl:w-56 xl:grid-cols-1 xl:self-start xl:sticky xl:top-6">
      {workspaceTabs.map((tab, index) => (
        <button
          key={tab.id} type="button" onClick={() => onNavigate(tab.id)}
          className={`min-h-11 rounded-lg px-3 py-2 text-left transition ${activeTab === tab.id ? "bg-[#2f2f9d] text-white shadow-soft" : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-navy"}`}
        >
          <span className="block text-sm font-bold tracking-normal">{index + 1}. {tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

function CustomerSelector({
  customers, selectedCustomer, showCustomers, onToggleSearch, onSelectCustomer, onAddCustomer,
  onRequestDelete, onDragStartCustomer, draggedCustomerId, dropIndex, onSetDropIndex,
  onDropCustomer, recentUpdatedAt, storageErrorMessage,
}: {
  customers: CustomerProfile[]; selectedCustomer: CustomerId; showCustomers: boolean;
  onToggleSearch: () => void; onSelectCustomer: (id: CustomerId) => void; onAddCustomer: () => void;
  onRequestDelete: () => void; onDragStartCustomer: (id: CustomerId | null) => void;
  draggedCustomerId: CustomerId | null; dropIndex: number | null;
  onSetDropIndex: (i: number | null) => void; onDropCustomer: (i: number) => void;
  recentUpdatedAt: number; storageErrorMessage: string;
}) {
  const currentCustomer = customers.find((c) => c.id === selectedCustomer);
  const [isDraggingTab, setIsDraggingTab] = useState(false);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-soft">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 flex-wrap gap-2">
          <button type="button" onClick={onToggleSearch} className={`min-h-11 rounded-lg px-4 py-2 text-left text-sm font-bold transition ${showCustomers ? "bg-[#2f2f9d] text-white" : "bg-slate-50 text-navy hover:bg-slate-100"}`}>고객명 검색</button>
          <button type="button" onClick={onAddCustomer} className="min-h-11 rounded-lg bg-samsung px-4 py-2 text-left text-sm font-bold text-white transition hover:bg-[#1b35bd]">고객 추가</button>
        </div>
        <div className="customer-current-summary grid grid-cols-[minmax(0,auto)_auto] content-start items-center justify-end gap-x-2 gap-y-1 self-start text-right">
          <p className="text-sm font-bold text-slate-600">현재 상담 고객: <span className="text-samsung">{currentCustomer ? customerTabLabel(currentCustomer) : "선택 대기"}</span></p>
          <button type="button" onClick={onRequestDelete} aria-label="현재 고객 삭제" className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 transition hover:border-red-300 hover:bg-red-100"><Trash2 size={17} /></button>
          <p className="basis-full text-xs font-bold text-slate-400">{formatUpdatedAt(recentUpdatedAt)}</p>
        </div>
      </div>
      {storageErrorMessage ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{storageErrorMessage}</div> : null}
      {showCustomers ? (
        <div className="mt-3 flex items-stretch overflow-x-auto pb-1" onDragLeave={(e) => { if (e.currentTarget === e.target) onSetDropIndex(null); }}>
          {customers.map((customer, index) => (
            <CustomerTabDragItem key={customer.id} customer={customer} index={index} selected={selectedCustomer === customer.id} dragging={draggedCustomerId === customer.id} dropBefore={dropIndex === index}
              onSelect={() => { if (!isDraggingTab) onSelectCustomer(customer.id); }}
              onDragStart={(e) => { setIsDraggingTab(true); onDragStartCustomer(customer.id); onSetDropIndex(index); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", customer.id); }}
              onDragOverIndex={onSetDropIndex} onDropIndex={onDropCustomer}
              onDragEnd={() => { onDragStartCustomer(null); onSetDropIndex(null); window.setTimeout(() => setIsDraggingTab(false), 0); }}
            />
          ))}
          <CustomerDropIndicator index={customers.length} active={dropIndex === customers.length} onDragOverIndex={onSetDropIndex} onDropIndex={onDropCustomer} />
        </div>
      ) : null}
    </section>
  );
}

function CustomerTabDragItem({ customer, index, selected, dragging, dropBefore, onSelect, onDragStart, onDragOverIndex, onDropIndex, onDragEnd }: {
  customer: CustomerProfile; index: number; selected: boolean; dragging: boolean; dropBefore: boolean;
  onSelect: () => void; onDragStart: (e: DragEvent<HTMLButtonElement>) => void;
  onDragOverIndex: (i: number | null) => void; onDropIndex: (i: number) => void; onDragEnd: () => void;
}) {
  return (
    <div className="flex shrink-0 items-stretch">
      <CustomerDropIndicator index={index} active={dropBefore} onDragOverIndex={onDragOverIndex} onDropIndex={onDropIndex} />
      <button type="button" draggable onClick={onSelect} onDragStart={onDragStart}
        onDragOver={(e) => { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); onDragOverIndex(e.clientX < rect.left + rect.width / 2 ? index : index + 1); }}
        onDrop={(e) => { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); onDropIndex(e.clientX < rect.left + rect.width / 2 ? index : index + 1); }}
        onDragEnd={onDragEnd}
        className={`min-h-11 shrink-0 rounded-lg border px-4 py-2 text-sm font-bold transition ${selected ? "border-samsung bg-blue-50 text-samsung" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"} ${dragging ? "opacity-45" : "opacity-100"}`}
      >
        {customerTabLabel(customer)}
      </button>
    </div>
  );
}

function CustomerDropIndicator({ index, active, onDragOverIndex, onDropIndex }: { index: number; active: boolean; onDragOverIndex: (i: number | null) => void; onDropIndex: (i: number) => void }) {
  return (
    <div className="flex w-3 shrink-0 items-center justify-center" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOverIndex(index); }} onDrop={(e) => { e.preventDefault(); onDropIndex(index); }}>
      <span className={`h-9 w-0.5 rounded-full transition ${active ? "bg-samsung opacity-100" : "bg-transparent opacity-0"}`} />
    </div>
  );
}

function DeleteCustomerDialog({ customerLabel, onCancel, onDelete }: { customerLabel: string; onCancel: () => void; onDelete: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700"><Trash2 size={20} /></div>
          <div>
            <h2 className="text-lg font-bold text-navy">고객 정보 삭제</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{customerLabel} 고객 정보가 모두 사라집니다. 정말 삭제하시겠습니까?</p>
          </div>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50">취소</button>
          <button type="button" onClick={onDelete} className="min-h-11 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700">삭제</button>
        </div>
      </section>
    </div>
  );
}

// ── Diff Helper ─────────────────────────────────────────────────────────────
function diffPayload(previous: ReturnType<typeof buildStructuredJsonPayload>, latest: ReturnType<typeof buildStructuredJsonPayload>): ChangeEntry[] {
  const now = Date.now();
  const flattenPayload = (p: ReturnType<typeof buildStructuredJsonPayload>) => [
    ["asset_summary", "자산 요약", p.basic_financial_info.asset_summary],
    ["annual_fixed_income", "연 고정소득", p.basic_financial_info.annual_fixed_income],
    ["return_objective", "투자 목적", p.rrttllu.return.objective],
    ["risk_score", "Risk 점수", `${p.rrttllu.risk.score}점`],
    ["risk_level", "위험등급", p.rrttllu.risk.level],
    ["investment_period", "투자 기간", p.rrttllu.time_horizon.investment_period],
    ["preferred_assets", "선호 자산", p.rrttllu.unique_circumstances.preferred_assets.raw_input],
    ["avoided_assets", "비선호 자산", p.rrttllu.unique_circumstances.avoided_assets.raw_input],
  ] as const;
  const prevMap = Object.fromEntries(flattenPayload(previous).map(([k, , v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "미입력")]));
  return flattenPayload(latest)
    .map(([key, label, v]) => ({ key, label, value: Array.isArray(v) ? v.join(", ") : (v ?? "미입력") }))
    .filter((f) => prevMap[f.key] !== f.value)
    .map((f, i) => ({ label: f.label, before: prevMap[f.key] ?? "미입력", after: f.value, changedAt: now - i }))
    .sort((a, b) => b.changedAt - a.changedAt);
}
