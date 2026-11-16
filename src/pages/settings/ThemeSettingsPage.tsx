import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, LogIn, RotateCcw, Save, Search } from 'lucide-react';
import { THEME_SHORT, useAppConfig } from '@/hooks/useAppConfig';
import { MultiPingNodeConfigPanel } from '@/matrix/components/theme/MultiPingNodeConfigPanel';
import { Flag } from '@/matrix/components/ui/Flag';
import { getAdminClients, getAdminPingTasks, getPublic, saveThemeSettings } from '@/matrix/services/api';
import type { AdminClient, PingTask } from '@/matrix/types/komari';
import {
  HOMEPAGE_MULTI_PING_TASK_COUNT,
  type HomepageMultiPingNodeTaskIds,
  type HomepagePingTaskBindings,
} from '@/matrix/utils/pingTasks';
import {
  completeMultiPingTaskIds,
  draftFromSettings,
  draftSignature,
  mergeDraftIntoSettings,
  multiPingSlots,
  parseTrafficResetDay,
  updateMultiPingSlot,
  validateDraft,
  type BooleanSettingKey,
  type SettingsDraft,
} from './settingsModel';
import '@/matrix/styles/settings.css';
import './settings.css';

type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

function useAdminData<T>(load: () => Promise<T>, enabled: boolean): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    load().then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      (error: unknown) => !cancelled && setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, load]);
  return state;
}

/* ─────────────────────────── small building blocks ─────────────────────────── */

function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="ts-settings-section" aria-labelledby={`${id}-title`}>
      <header className="ts-settings-section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      <div className="ts-settings-section-body">{children}</div>
    </section>
  );
}

function Toggle({
  field,
  draft,
  onChange,
  title,
  desc,
  disabled,
}: {
  field: BooleanSettingKey;
  draft: SettingsDraft;
  onChange: (key: BooleanSettingKey, value: boolean) => void;
  title: string;
  desc?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`ts-settings-row ${disabled ? 'is-disabled' : ''}`}>
      <span className="ts-settings-row-text">
        <span className="ts-settings-row-title">{title}</span>
        {desc && <span className="ts-settings-row-desc">{desc}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={draft[field]}
        disabled={disabled}
        onChange={(event) => onChange(field, event.target.checked)}
      />
    </label>
  );
}

function Choice<T extends string>({
  title,
  desc,
  value,
  options,
  onChange,
}: {
  title: string;
  desc?: string;
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="ts-settings-row">
      <span className="ts-settings-row-text">
        <span className="ts-settings-row-title">{title}</span>
        {desc && <span className="ts-settings-row-desc">{desc}</span>}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  title,
  desc,
  value,
  placeholder,
  onChange,
  list,
}: {
  title: string;
  desc?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  list?: string;
}) {
  return (
    <label className="ts-settings-row is-stacked">
      <span className="ts-settings-row-text">
        <span className="ts-settings-row-title">{title}</span>
        {desc && <span className="ts-settings-row-desc">{desc}</span>}
      </span>
      <input type="text" value={value} placeholder={placeholder} list={list} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/* ─────────────────────────── latency bindings ─────────────────────────── */

function invertBindings(bindings: HomepagePingTaskBindings): Map<string, string> {
  const owner = new Map<string, string>();
  for (const [taskId, uuids] of Object.entries(bindings)) for (const uuid of uuids) owner.set(uuid, taskId);
  return owner;
}

/** One node shows at most one task in single-line mode: assigning moves it from any other task. */
function assignNode(bindings: HomepagePingTaskBindings, taskId: number, uuid: string, checked: boolean): HomepagePingTaskBindings {
  const key = String(taskId);
  const next: HomepagePingTaskBindings = {};
  for (const [task, uuids] of Object.entries(bindings)) {
    const kept = uuids.filter((value) => value !== uuid);
    if (kept.length > 0) next[task] = kept;
  }
  if (checked) next[key] = [...(next[key] ?? []), uuid];
  return next;
}

function TaskBindings({
  tasks,
  clients,
  bindings,
  onChange,
}: {
  tasks: PingTask[];
  clients: AdminClient[];
  bindings: HomepagePingTaskBindings;
  onChange: (next: HomepagePingTaskBindings) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const owner = useMemo(() => invertBindings(bindings), [bindings]);
  const missingTaskIds = Object.keys(bindings).filter((id) => !tasks.some((task) => task.id === Number(id)));
  const clientName = useMemo(() => new Map(clients.map((client) => [client.uuid, client.name || client.uuid])), [clients]);
  const keyword = search.trim().toLowerCase();
  const visibleClients = useMemo(
    () =>
      keyword
        ? clients.filter((client) =>
            [client.name, client.uuid, client.group, client.region].some((value) => String(value ?? '').toLowerCase().includes(keyword)),
          )
        : clients,
    [clients, keyword],
  );

  return (
    <div className="ts-task-list">
      {missingTaskIds.map((id) => (
        <div key={id} className="ts-settings-row">
          <span>{t('settings.latency.deletedTask', { id })}</span>
          <button type="button" className="ts-button" onClick={() => {
            const next = { ...bindings };
            delete next[id];
            onChange(next);
          }}>
            {t('settings.latency.clear')}
          </button>
        </div>
      ))}
      {tasks.map((task) => {
        const assigned = bindings[String(task.id)] ?? [];
        const isOpen = expanded === task.id;
        const supported = new Set(task.clients);
        return (
          <div key={task.id} className="ts-task">
            <div className="ts-task-head">
              <div className="ts-task-title">
                <strong>{task.name || t('settings.latency.taskFallback', { id: task.id })}</strong>
                <span className="ts-chip">{task.type || 'icmp'}</span>
                <span className="ts-chip">{task.interval}s</span>
                <span className="ts-chip">ID {task.id}</span>
              </div>
              <div className="ts-task-summary">
                {assigned.length === 0
                  ? t('settings.latency.noneBound')
                  : assigned.map((uuid) => clientName.get(uuid) ?? uuid).join('、')}
              </div>
              <div className="ts-task-actions">
                {assigned.length > 0 && (
                  <button
                    type="button"
                    className="ts-button is-ghost"
                    onClick={() => {
                      const next = { ...bindings };
                      delete next[String(task.id)];
                      onChange(next);
                    }}
                  >
                    {t('settings.latency.clear')}
                  </button>
                )}
                <button type="button" className="ts-button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : task.id)}>
                  {isOpen ? t('settings.latency.collapse') : t('settings.latency.editNodes', { count: assigned.length })}
                </button>
              </div>
            </div>
            {isOpen && (
              <div className="ts-task-body">
                <label className="ts-search">
                  <Search size={14} aria-hidden />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('settings.latency.searchNodes')} />
                </label>
                <div className="ts-node-grid">
                  {visibleClients.map((client) => {
                    const checked = assigned.includes(client.uuid);
                    const elsewhere = !checked && owner.has(client.uuid);
                    const unsupported = !supported.has(client.uuid);
                    return (
                      <label key={client.uuid} className={`ts-node ${checked ? 'is-checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => onChange(assignNode(bindings, task.id, client.uuid, event.target.checked))}
                        />
                        <span className="ts-node-text">
                          <span className="ts-node-name">
                            <Flag region={client.region} size={13} />
                            <span>{client.name || client.uuid}</span>
                          </span>
                          <span className="ts-node-meta">
                            {[client.group, elsewhere ? t('settings.latency.movesFrom') : '', unsupported ? t('settings.latency.notProbed') : '']
                              .filter(Boolean)
                              .join(' · ') || '\u00a0'}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── page ─────────────────────────── */

export default function ThemeSettingsPage() {
  const { t } = useTranslation();
  const appConfig = useAppConfig();
  const { isLoggedIn, loaded, serverTheme, themeSettingsRaw, refresh } = appConfig;
  const canWrite = isLoggedIn && serverTheme === THEME_SHORT;

  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromSettings(themeSettingsRaw));
  const [baseline, setBaseline] = useState<SettingsDraft>(() => draftFromSettings(themeSettingsRaw));
  const [multiSlots, setMultiSlots] = useState(() => multiPingSlots(draft.homepageMultiPingTaskIds));
  const [resetDayInputs, setResetDayInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [multiPanelOpen, setMultiPanelOpen] = useState(false);

  // Re-seed from the server once settings arrive, unless the admin already started editing.
  const serverSignature = useMemo(() => draftSignature(draftFromSettings(themeSettingsRaw)), [themeSettingsRaw]);
  const invalidResetDays = Object.values(resetDayInputs).some((raw) => !parseTrafficResetDay(raw).valid);
  const dirty = draftSignature(draft) !== draftSignature(baseline)
    || JSON.stringify(multiSlots) !== JSON.stringify(multiPingSlots(baseline.homepageMultiPingTaskIds))
    || invalidResetDays;
  useEffect(() => {
    if (dirty) return;
    const next = draftFromSettings(themeSettingsRaw);
    setDraft(next);
    setBaseline(next);
    setMultiSlots(multiPingSlots(next.homepageMultiPingTaskIds));
    setResetDayInputs({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSignature]);

  const loadTasks = useCallback(() => getAdminPingTasks(), []);
  const loadClients = useCallback(() => getAdminClients(), []);
  const tasksState = useAdminData(loadTasks, isLoggedIn);
  const clientsState = useAdminData(loadClients, isLoggedIn);
  const tasks = useMemo(
    () => (tasksState.status === 'ready' ? [...tasksState.data].sort((a, b) => a.weight - b.weight || a.id - b.id) : []),
    [tasksState],
  );
  const clients = useMemo(
    () => (clientsState.status === 'ready' ? [...clientsState.data].sort((a, b) => a.weight - b.weight) : []),
    [clientsState],
  );

  const knownTaskIds = useMemo(() => tasksState.status === 'ready' ? new Set(tasks.map((task) => task.id)) : undefined, [tasks, tasksState.status]);
  const problems = validateDraft(draft.enableHomepageMultiPing
    ? { ...draft, homepageMultiPingTaskIds: completeMultiPingTaskIds(multiSlots) }
    : draft, knownTaskIds);
  if (invalidResetDays) problems.push('resetDayInvalid');
  const patch = useCallback(<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSavedAt(null);
    setSaveConflict(false);
  }, []);
  const patchBool = useCallback((key: BooleanSettingKey, value: boolean) => patch(key, value), [patch]);
  const closeMultiPanel = useCallback(() => setMultiPanelOpen(false), []);
  const changeNodeTasks = useCallback((next: HomepageMultiPingNodeTaskIds) => patch('homepageMultiPingNodeTaskIds', next), [patch]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!canWrite || problems.length > 0) return false;
    setSaving(true);
    setSaveError(null);
    try {
      // Read the server's current record, merge, then write — never overwrite other keys.
      const latest = await getPublic();
      if (latest.theme !== THEME_SHORT) throw new Error(t('settings.errors.themeSwitched'));
      const merged = mergeDraftIntoSettings(latest.theme_settings ?? {}, draft, baseline);
      await saveThemeSettings(THEME_SHORT, merged.settings);
      const savedDraft = draftFromSettings(merged.settings);
      setBaseline(savedDraft);
      // Preserve edits made while saving, but adopt untouched values from the latest record.
      setDraft((current) => draftFromSettings(mergeDraftIntoSettings(merged.settings, current, draft).settings));
      setMultiSlots((current) => JSON.stringify(current) === JSON.stringify(multiSlots) ? multiPingSlots(savedDraft.homepageMultiPingTaskIds) : current);
      setResetDayInputs((current) => Object.fromEntries(Object.entries(current).filter(([uuid, raw]) => raw !== resetDayInputs[uuid])));
      setSaveConflict(merged.conflicts.length > 0);
      setSavedAt(Date.now());
      await refresh();
      return true;
    } catch (error) {
      const status = (error as { status?: number }).status;
      setSaveError(status === 401 || status === 403 ? t('settings.errors.expired') : error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSaving(false);
    }
  }, [baseline, canWrite, draft, multiSlots, problems.length, refresh, resetDayInputs, t]);

  // The latency panel depends on callback identity; delegate to the latest save snapshot.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  const saveFromPanel = useCallback(() => saveRef.current(), []);

  const reset = () => {
    const next = draftFromSettings(themeSettingsRaw);
    setDraft(next);
    setBaseline(next);
    setMultiSlots(multiPingSlots(next.homepageMultiPingTaskIds));
    setResetDayInputs({});
    setSaveError(null);
    setSavedAt(null);
    setSaveConflict(false);
  };

  if (!loaded) {
    return <div className="ts-settings-page"><p className="ts-settings-muted">{t('settings.loading')}</p></div>;
  }

  if (!isLoggedIn) {
    return (
      <div className="ts-settings-page">
        <div className="ts-settings-gate">
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.loginRequired')}</p>
          <a className="ts-button is-primary" href="/admin">
            <LogIn size={14} aria-hidden />
            {t('settings.goLogin')}
          </a>
        </div>
      </div>
    );
  }

  const multiTaskIds = draft.homepageMultiPingTaskIds;
  const multiConfigured = Object.keys(draft.homepageMultiPingNodeTaskIds).length;
  const viewOptions = [
    { value: 'globe' as const, label: t('view.globe'), disabled: !draft.enable_globe },
    { value: 'matrix' as const, label: t('view.matrix'), disabled: !draft.enable_matrix },
    { value: 'grid' as const, label: t('view.grid') },
    { value: 'table' as const, label: t('view.table') },
    { value: 'uptime' as const, label: t('view.uptime'), disabled: !draft.enable_uptime },
  ];

  return (
    <div className="ts-settings-page">
      <header className="ts-settings-header">
        <div>
          <Link to="/" className="ts-back">
            <ArrowLeft size={14} aria-hidden />
            {t('action.home')}
          </Link>
          <h1>{t('settings.title')}</h1>
          <p className="ts-settings-muted">{t('settings.subtitle')}</p>
        </div>
      </header>

      {!canWrite && (
        <div className="ts-settings-banner" role="status">
          {t('settings.readOnly', { theme: serverTheme || '—' })}
        </div>
      )}

      <Section id="views" title={t('settings.sections.views')}>
        <Choice title={t('settings.defaultView')} value={draft.default_view} options={viewOptions} onChange={(v) => patch('default_view', v)} />
        <Toggle field="enable_globe" draft={draft} onChange={patchBool} title={t('settings.enableGlobe')} />
        <Toggle field="enable_matrix" draft={draft} onChange={patchBool} title={t('settings.enableMatrix')} />
        <Toggle field="enable_uptime" draft={draft} onChange={patchBool} title={t('settings.enableUptime')} />
        <Choice
          title={t('settings.defaultTheme')}
          desc={t('settings.defaultThemeDesc')}
          value={draft.default_theme}
          options={[
            { value: 'clean', label: t('theme.clean') },
            { value: 'deepspace', label: t('theme.deepspace') },
            { value: 'auto', label: t('theme.auto') },
          ]}
          onChange={(v) => patch('default_theme', v)}
        />
      </Section>

      <Section id="overview" title={t('settings.sections.overview')} description={t('settings.overviewDesc')}>
        <Toggle field="enable_cluster_panel" draft={draft} onChange={patchBool} title={t('settings.clusterPanel')} desc={t('settings.clusterPanelDesc')} />
        <Toggle field="showGroupTabs" draft={draft} onChange={patchBool} title={t('settings.groupTabs')} />
        <Toggle field="showRegionBar" draft={draft} onChange={patchBool} title={t('settings.regionBar')} desc={t('settings.regionBarDesc')} />
        <Toggle field="enable_asset_stats" draft={draft} onChange={patchBool} title={t('settings.assetStats')} desc={t('settings.assetStatsDesc')} />
      </Section>

      <Section id="matrix" title={t('settings.sections.matrix')}>
        <Choice
          title={t('settings.cardLayout')}
          desc={t('settings.cardLayoutDesc')}
          value={draft.cardProgressLayout}
          options={[
            { value: '2col', label: t('settings.cardLayout2') },
            { value: '1col', label: t('settings.cardLayout1') },
          ]}
          onChange={(v) => patch('cardProgressLayout', v)}
        />
        <Toggle field="trafficSplitColor" draft={draft} onChange={patchBool} title={t('settings.trafficSplit')} desc={t('settings.trafficSplitDesc')} />
        <Toggle field="showCardGroup" draft={draft} onChange={patchBool} title={t('settings.cardGroup')} />
        <Toggle field="showConnections" draft={draft} onChange={patchBool} title={t('settings.connections')} desc={t('settings.matrixOnly')} />
        <Toggle field="showTodayTrafficPopover" draft={draft} onChange={patchBool} title={t('settings.todayTraffic')} desc={t('settings.matrixOnly')} />
        <Toggle field="showCostsToGuests" draft={draft} onChange={patchBool} title={t('settings.costsToGuests')} desc={t('settings.costsToGuestsDesc')} />
        <div className="ts-settings-row is-stacked">
          <span className="ts-settings-row-text">
            <span className="ts-settings-row-title">{t('settings.resetDays')}</span>
            <span className="ts-settings-row-desc">{t('settings.resetDaysDesc')}</span>
          </span>
          <div className="ts-reset-grid">
            {clients.map((client) => {
              const raw = resetDayInputs[client.uuid] ?? String(draft.trafficResetDays[client.uuid] ?? '');
              const invalid = !parseTrafficResetDay(raw).valid;
              return (
                <label key={client.uuid} className="ts-reset-item">
                  <span className="ts-node-name">
                    <Flag region={client.region} size={13} />
                    <span>{client.name || client.uuid}</span>
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="—"
                    value={raw}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? `reset-day-error-${client.uuid}` : undefined}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResetDayInputs((current) => ({ ...current, [client.uuid]: value }));
                      setSavedAt(null);
                      setSaveConflict(false);
                      const parsed = parseTrafficResetDay(value);
                      if (!parsed.valid) return;
                      const next = { ...draft.trafficResetDays };
                      if (parsed.day === null) delete next[client.uuid];
                      else next[client.uuid] = parsed.day;
                      patch('trafficResetDays', next);
                    }}
                  />
                  {invalid && <span id={`reset-day-error-${client.uuid}`} className="ts-settings-error" role="alert">{t('settings.errors.resetDayInvalid')}</span>}
                </label>
              );
            })}
          </div>
        </div>
      </Section>

      <Section id="latency" title={t('settings.sections.latency')} description={t('settings.latency.desc')}>
        <Toggle field="showLatency" draft={draft} onChange={patchBool} title={t('settings.latency.show')} desc={t('settings.latency.showDesc')} />
        {tasksState.status === 'error' || clientsState.status === 'error' ? (
          <p className="ts-settings-error" role="alert">{t('settings.errors.adminData')}</p>
        ) : tasksState.status === 'loading' || clientsState.status === 'loading' ? (
          <p className="ts-settings-muted">{t('settings.loading')}</p>
        ) : (
          <>
            {tasks.length === 0 && (
              <p className="ts-settings-muted">
                {t('settings.latency.noTasks')} <a href="/admin/ping">{t('settings.latency.goCreate')}</a>
              </p>
            )}
            <div className={`ts-multi ${draft.enableHomepageMultiPing ? 'is-on' : ''}`}>
              <Toggle
                field="enableHomepageMultiPing"
                draft={draft}
                onChange={patchBool}
                title={t('settings.latency.multi')}
                desc={t('settings.latency.multiDesc')}
                disabled={!draft.enableHomepageMultiPing && tasks.length < HOMEPAGE_MULTI_PING_TASK_COUNT}
              />
              {(draft.enableHomepageMultiPing || multiSlots.some((id) => id !== null) || multiConfigured > 0) && (
                <div className="ts-multi-body">
                  <div className="ts-multi-slots">
                    {Array.from({ length: HOMEPAGE_MULTI_PING_TASK_COUNT }, (_, slot) => {
                      const selected = multiSlots[slot];
                      return (
                        <label key={slot}>
                          <span>{t('settings.latency.line', { n: slot + 1 })}</span>
                          <select
                            value={selected ?? ''}
                            onChange={(event) => {
                              const id = event.target.value === '' ? null : Number(event.target.value);
                              const next = updateMultiPingSlot(multiSlots, slot, id);
                              setMultiSlots(next);
                              setSavedAt(null);
                              setSaveConflict(false);
                              const complete = completeMultiPingTaskIds(next);
                              if (complete.length === HOMEPAGE_MULTI_PING_TASK_COUNT) patch('homepageMultiPingTaskIds', complete);
                            }}
                          >
                            <option value="">{t('settings.latency.pickTask')}</option>
                            {selected !== null && !knownTaskIds?.has(selected) && (
                              <option value={selected} disabled>{t('settings.latency.deletedTask', { id: selected })}</option>
                            )}
                            {tasks.map((task) => (
                              <option key={task.id} value={task.id} disabled={task.id !== selected && multiSlots.includes(task.id)}>
                                {task.name || t('settings.latency.taskFallback', { id: task.id })}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                  <p className={problems.includes('multiPingIncomplete') ? 'ts-settings-error' : 'ts-settings-muted'}>
                    {problems.includes('multiPingIncomplete') ? t('settings.latency.multiIncomplete') : t('settings.latency.multiHint')}
                  </p>
                  <button type="button" className="ts-button is-ghost" onClick={() => {
                    setMultiSlots(multiPingSlots([]));
                    patch('homepageMultiPingTaskIds', []);
                  }}>
                    {t('settings.latency.clearGlobal')}
                  </button>
                  <div className="ts-multi-override">
                    <span className="ts-settings-muted">{t('settings.latency.overrideCount', { count: multiConfigured, total: clients.length })}</span>
                    <button type="button" className="ts-button" disabled={problems.includes('multiPingIncomplete')} onClick={() => setMultiPanelOpen(true)}>
                      {t('settings.latency.perServer')}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <p className="ts-settings-muted">{t('settings.latency.singleHint')}</p>
            <TaskBindings tasks={tasks} clients={clients} bindings={draft.homepagePingBindings} onChange={(next) => patch('homepagePingBindings', next)} />
          </>
        )}
      </Section>

      <Section id="globe" title={t('settings.sections.globe')}>
        <TextField
          title={t('settings.hubNode')}
          desc={t('settings.hubNodeDesc')}
          value={draft.globe_hub_node}
          placeholder={t('settings.hubNodePlaceholder')}
          list="ts-node-names"
          onChange={(v) => patch('globe_hub_node', v)}
        />
        <datalist id="ts-node-names">
          {clients.map((client) => <option key={client.uuid} value={client.name} />)}
        </datalist>
        <Choice
          title={t('settings.globeMode')}
          value={draft.globe_mode}
          options={[
            { value: 'dynamic', label: t('settings.globeDynamic') },
            { value: 'static', label: t('settings.globeStatic') },
          ]}
          onChange={(v) => patch('globe_mode', v)}
        />
        <Toggle field="globe_respect_reduced_motion" draft={draft} onChange={patchBool} title={t('settings.reducedMotion')} />
        <Choice
          title={t('settings.markerStyle')}
          value={draft.globe_marker_style}
          options={[
            { value: 'rich', label: t('settings.markerRich') },
            { value: 'calm', label: t('settings.markerCalm') },
            { value: 'lite', label: t('settings.markerLite') },
          ]}
          onChange={(v) => patch('globe_marker_style', v)}
        />
      </Section>

      <Section id="site" title={t('settings.sections.site')}>
        <Toggle field="enable_privacy_mode" draft={draft} onChange={patchBool} title={t('settings.privacy')} desc={t('settings.privacyDesc')} />
        <Toggle field="hide_footer_credit" draft={draft} onChange={patchBool} title={t('settings.hideCredit')} desc={t('settings.hideCreditDesc')} />
        <TextField
          title={t('settings.customFooter')}
          value={draft.custom_footer}
          placeholder={t('settings.customFooterPlaceholder')}
          onChange={(v) => patch('custom_footer', v)}
        />
        <p className="ts-settings-muted">{t('settings.publicNote')}</p>
      </Section>

      <div className="ts-settings-savebar" role="region" aria-label={t('settings.save')}>
        <span className={saveError ? 'ts-settings-error' : 'ts-settings-muted'} role={saveError ? 'alert' : 'status'}>
          {saveError ?? (savedAt ? t(saveConflict ? 'settings.savedConflict' : 'settings.saved') : dirty ? t('settings.unsaved') : t('settings.noChanges'))}
        </span>
        <div className="ts-settings-savebar-actions">
          <button type="button" className="ts-button is-ghost" disabled={!dirty || saving} onClick={reset}>
            <RotateCcw size={14} aria-hidden />
            {t('settings.reset')}
          </button>
          <button type="button" className="ts-button is-primary" disabled={!canWrite || !dirty || saving || problems.length > 0} onClick={() => void save()}>
            <Save size={14} aria-hidden />
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </div>

      {problems.filter((problem) => problem !== 'multiPingIncomplete').map((problem) => (
        <p key={problem} className="ts-settings-error" role="alert">{t(`settings.errors.${problem}`)}</p>
      ))}

      {multiPanelOpen && (
        <MultiPingNodeConfigPanel
          open
          clients={clients}
          tasks={tasks}
          globalTaskIds={multiTaskIds}
          nodeTaskIds={draft.homepageMultiPingNodeTaskIds}
          saving={saving}
          saveDisabled={!canWrite || saving || problems.length > 0}
          saveError={saveError}
          onChange={changeNodeTasks}
          onClose={closeMultiPanel}
          onSave={saveFromPanel}
        />
      )}
    </div>
  );
}
