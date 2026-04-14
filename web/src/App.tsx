import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import { useEffect, useMemo, useState } from "react";

const NEWSBANK_CONFIG_QUERY = gql`
  query NewsbankRequestConfig {
    newsbankRequestConfig {
      id
      key
      curl
      requestUrl
      method
      cookieHeader
      headers
      bodyText
      updatedAt
    }
  }
`;

const SEARCH_COLUMNS = gql`
  query SearchColumns($query: String, $tags: [String!], $limit: Int, $offset: Int) {
    searchColumns(query: $query, tags: $tags, limit: $limit, offset: $offset) {
      id
      title
      date
      snippet
      url
      extractionMethod
      contentExtractedAt
      tags
      source {
        id
        name
      }
    }
  }
`;

const SEARCH_COLUMNS_PAGE_FOR_DATE = gql`
  query SearchColumnsPageForDate($date: String!, $query: String, $tags: [String!], $pageSize: Int) {
    searchColumnsPageForDate(date: $date, query: $query, tags: $tags, pageSize: $pageSize)
  }
`;

const NEIGHBORING_COLUMNS = gql`
  query NeighboringColumns($id: ID!, $limit: Int) {
    neighboringColumns(id: $id, limit: $limit) {
      id
      title
      date
      tags
      source {
        id
        name
      }
    }
  }
`;

const COLUMN_QUERY = gql`
  query Column($id: ID!) {
    column(id: $id) {
      id
      title
      date
      url
      snippet
      bodyText
      sourceMetadata
      publicationName
      byline
      articleSection
      wordCount
      extractionMethod
      contentExtractedAt
      tags
      source {
        id
        name
        url
      }
    }
  }
`;

const SAVE_NEWSBANK_CONFIG = gql`
  mutation SaveNewsbankRequestConfig($curl: String!) {
    saveNewsbankRequestConfig(curl: $curl) {
      id
      key
      curl
      requestUrl
      method
      cookieHeader
      headers
      bodyText
      updatedAt
    }
  }
`;

const NEWSBANK_SYNC_STATUS = gql`
  query NewsbankSyncStatus {
    newsbankSyncStatus {
      isRunning
      activeRun {
        id
        sourceName
        status
        pruneStale
        maxPages
        maxArticles
        totalDiscovered
        processedCount
        insertedCount
        updatedCount
        skippedExistingCount
        failedCount
        deletedStaleCount
        errorMessage
        startedAt
        finishedAt
        progressPercent
      }
      latestRun {
        id
        sourceName
        status
        pruneStale
        maxPages
        maxArticles
        totalDiscovered
        processedCount
        insertedCount
        updatedCount
        skippedExistingCount
        failedCount
        deletedStaleCount
        errorMessage
        startedAt
        finishedAt
        progressPercent
      }
    }
  }
`;

const START_NEWSBANK_SYNC = gql`
  mutation StartNewsbankSync($maxPages: Int, $maxArticles: Int, $pruneStale: Boolean) {
    startNewsbankSync(maxPages: $maxPages, maxArticles: $maxArticles, pruneStale: $pruneStale) {
      id
      status
      pruneStale
      maxPages
      maxArticles
      totalDiscovered
      processedCount
      insertedCount
      updatedCount
      skippedExistingCount
      failedCount
      deletedStaleCount
      errorMessage
      startedAt
      finishedAt
      progressPercent
    }
  }
`;

const UPDATE_COLUMN_TAGS = gql`
  mutation UpdateColumnTags($id: ID!, $tags: [String!]!) {
    updateColumnTags(id: $id, tags: $tags) {
      id
      tags
    }
  }
`;

const UPDATE_COLUMN_TITLE = gql`
  mutation UpdateColumnTitle($id: ID!, $title: String!) {
    updateColumnTitle(id: $id, title: $title) {
      id
      title
    }
  }
`;

const MARK_COLUMN_DUPLICATE = gql`
  mutation MarkColumnDuplicate($id: ID!) {
    markColumnDuplicate(id: $id)
  }
`;

type NewsbankRequestConfig = {
  id: string;
  key: string;
  curl: string;
  requestUrl?: string | null;
  method: string;
  cookieHeader?: string | null;
  headers: string;
  bodyText?: string | null;
  updatedAt: string;
};

type Column = {
  id: string;
  title: string;
  date: string;
  snippet?: string | null;
  url?: string | null;
  bodyText?: string | null;
  sourceMetadata?: string | null;
  publicationName?: string | null;
  byline?: string | null;
  articleSection?: string | null;
  wordCount?: number | null;
  extractionMethod?: string | null;
  contentExtractedAt?: string | null;
  tags: string[];
  source: {
    id: string;
    name: string;
    url?: string | null;
  };
};

type SyncRun = {
  id: string;
  sourceName: string;
  status: string;
  pruneStale: boolean;
  maxPages?: number | null;
  maxArticles?: number | null;
  totalDiscovered: number;
  processedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedExistingCount: number;
  failedCount: number;
  deletedStaleCount: number;
  errorMessage?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  progressPercent: number;
};

type SyncStatus = {
  isRunning: boolean;
  activeRun?: SyncRun | null;
  latestRun?: SyncRun | null;
};

type View = "columns" | "table" | "admin";
const TABLE_PAGE_SIZE = 100;

const truncateWords = (value: string | null | undefined, maxWords: number) => {
  if (!value) return "-";

  const words = value.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
};

const normalizeExcerpt = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

const parseTagInput = (value: string) => {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const rawTag of value.split(",")) {
    const tag = rawTag.trim();
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    tags.push(tag);
  }

  return tags;
};

const isSnippetDuplicatedInBody = (snippet: string | null | undefined, bodyText: string | null | undefined) => {
  if (!snippet || !bodyText) return false;

  const normalizedSnippet = normalizeExcerpt(snippet);
  const normalizedBody = normalizeExcerpt(bodyText);
  if (!normalizedSnippet || !normalizedBody) return false;

  // NewsBank snippet is frequently persisted as the first 280 chars of body text.
  return normalizedBody.startsWith(normalizedSnippet);
};

const isView = (value: string): value is View => value === "columns" || value === "table" || value === "admin";

const getHashState = (): { view: View; columnId: string | null } => {
  if (typeof window === "undefined") {
    return { view: "table", columnId: null };
  }

  const raw = window.location.hash.replace(/^#/, "").trim();
  if (!raw) {
    return { view: "table", columnId: null };
  }

  if (raw.startsWith("columns/")) {
    const columnId = raw.slice("columns/".length).trim();
    return { view: "columns", columnId: columnId || null };
  }

  if (raw === "index" || raw === "table") {
    return { view: "table", columnId: null };
  }

  if (isView(raw)) {
    return { view: raw, columnId: null };
  }

  return { view: "table", columnId: null };
};

const toHash = (view: View, columnId: string | null) => {
  if (view === "columns" && columnId) {
    return `#columns/${columnId}`;
  }

  if (view === "table") {
    return "#inex";
  }

  return `#${view}`;
};

function App() {
  const initialHashState = getHashState();
  const [view, setView] = useState<View>(initialHashState.view);
  const [tableQuery, setTableQuery] = useState("");
  const [selectedTableTag, setSelectedTableTag] = useState("");
  const [tableOffset, setTableOffset] = useState(0);
  const [tableJumpDate, setTableJumpDate] = useState("");
  const [tableTagDrafts, setTableTagDrafts] = useState<Record<string, string>>({});
  const [savingTagRowId, setSavingTagRowId] = useState<string | null>(null);
  const [markingDuplicateRowId, setMarkingDuplicateRowId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(initialHashState.columnId);
  const [isEditingColumnTitle, setIsEditingColumnTitle] = useState(false);
  const [columnTitleDraft, setColumnTitleDraft] = useState("");
  const [columnTagDraft, setColumnTagDraft] = useState("");
  const [isSavingActiveColumnTags, setIsSavingActiveColumnTags] = useState(false);
  const [curlInput, setCurlInput] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncMaxPages, setSyncMaxPages] = useState("");
  const [syncMaxArticles, setSyncMaxArticles] = useState("");
  const [syncPruneStale, setSyncPruneStale] = useState(false);

  const [fetchTablePageForDate, { loading: tableJumpLoading, error: tableJumpError }] = useLazyQuery<{
    searchColumnsPageForDate: number;
  }>(SEARCH_COLUMNS_PAGE_FOR_DATE);
  const [fetchLatestColumn] = useLazyQuery<{ searchColumns: Column[] }>(SEARCH_COLUMNS);
  const {
    data: configData,
    loading: configLoading,
    error: configError,
    refetch: refetchConfig
  } = useQuery<{ newsbankRequestConfig: NewsbankRequestConfig | null }>(NEWSBANK_CONFIG_QUERY);
  const {
    data: columnData,
    loading: columnLoading,
    error: columnError,
    refetch: refetchActiveColumn
  } = useQuery<{ column: Column | null }>(COLUMN_QUERY, {
    variables: { id: activeColumnId },
    skip: !activeColumnId
  });
  const {
    data: neighboringColumnsData,
    loading: neighboringColumnsLoading,
    error: neighboringColumnsError,
    refetch: refetchNeighboringColumns
  } = useQuery<{ neighboringColumns: Column[] }>(NEIGHBORING_COLUMNS, {
    variables: { id: activeColumnId, limit: 21 },
    skip: !activeColumnId
  });
  const {
    data: tableData,
    loading: tableLoading,
    error: tableError,
    refetch: refetchTable
  } = useQuery<{ searchColumns: Column[] }>(SEARCH_COLUMNS, {
    variables: {
      query: null,
      tags: null,
      limit: TABLE_PAGE_SIZE,
      offset: 0
    }
  });
  const {
    data: tableTagOptionsData,
    refetch: refetchTableTagOptions
  } = useQuery<{ searchColumns: Column[] }>(SEARCH_COLUMNS, {
    variables: {
      query: tableQuery.trim() ? tableQuery.trim() : null,
      tags: null,
      limit: 500,
      offset: 0
    }
  });

  const [saveConfig, { data: saveData, loading: saveLoading, error: saveError }] = useMutation<{
    saveNewsbankRequestConfig: NewsbankRequestConfig;
  }>(SAVE_NEWSBANK_CONFIG);
  const {
    data: syncStatusData,
    loading: syncStatusLoading,
    error: syncStatusError,
    refetch: refetchSyncStatus
  } = useQuery<{ newsbankSyncStatus: SyncStatus }>(NEWSBANK_SYNC_STATUS, {
    pollInterval: 3000
  });
  const [startSync, { loading: startSyncLoading, error: startSyncError }] = useMutation<{
    startNewsbankSync: SyncRun;
  }>(START_NEWSBANK_SYNC);
  const [updateColumnTags, { error: updateTagsError }] = useMutation<{ updateColumnTags: Pick<Column, "id" | "tags"> }>(
    UPDATE_COLUMN_TAGS
  );
  const [updateColumnTitle, { loading: isSavingColumnTitle, error: updateTitleError }] = useMutation<{
    updateColumnTitle: Pick<Column, "id" | "title">;
  }>(UPDATE_COLUMN_TITLE);
  const [markColumnDuplicate, { error: markDuplicateError }] = useMutation<{ markColumnDuplicate: boolean }>(
    MARK_COLUMN_DUPLICATE
  );

  useEffect(() => {
    if (!curlInput && configData?.newsbankRequestConfig?.curl) {
      setCurlInput(configData.newsbankRequestConfig.curl);
    }
  }, [configData, curlInput]);

  const activeConfig = useMemo(
    () => saveData?.saveNewsbankRequestConfig ?? configData?.newsbankRequestConfig ?? null,
    [configData, saveData]
  );

  const syncStatus = syncStatusData?.newsbankSyncStatus ?? {
    isRunning: false,
    activeRun: null,
    latestRun: null
  };
  const statusRun = syncStatus.activeRun ?? syncStatus.latestRun ?? null;

  const neighboringColumns = neighboringColumnsData?.neighboringColumns ?? [];
  const activeColumn = columnData?.column ?? null;
  const showActiveColumnSnippet =
    Boolean(activeColumn?.snippet) &&
    !isSnippetDuplicatedInBody(activeColumn?.snippet, activeColumn?.bodyText);

  useEffect(() => {
    setColumnTagDraft(activeColumn?.tags.join(", ") ?? "");
  }, [activeColumn?.id, activeColumn?.tags]);

  useEffect(() => {
    setColumnTitleDraft(activeColumn?.title ?? "");
    setIsEditingColumnTitle(false);
  }, [activeColumn?.id, activeColumn?.title]);

  const tableRows = tableData?.searchColumns ?? [];
  const tableTagOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();

    for (const row of tableTagOptionsData?.searchColumns ?? []) {
      for (const tag of row.tags) {
        const key = tag.toLowerCase();
        const existing = counts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(key, { label: tag, count: 1 });
        }
      }
    }

    return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [tableTagOptionsData]);

  const sortedTableRows = tableRows;

  const saveNewsbankCurl = async () => {
    setSaveMessage(null);
    const response = await saveConfig({ variables: { curl: curlInput } });
    await refetchConfig();

    const updatedAt = response.data?.saveNewsbankRequestConfig.updatedAt;
    setSaveMessage(
      updatedAt
        ? `Saved Newsbank request config at ${new Date(updatedAt).toLocaleString()}.`
        : "Saved Newsbank request config."
    );
  };

  const startNewsbankSync = async () => {
    setSyncMessage(null);

    const parsedMaxPages = Number(syncMaxPages);
    const parsedMaxArticles = Number(syncMaxArticles);
    const maxPages = Number.isFinite(parsedMaxPages) && parsedMaxPages > 0 ? Math.floor(parsedMaxPages) : null;
    const maxArticles =
      Number.isFinite(parsedMaxArticles) && parsedMaxArticles > 0 ? Math.floor(parsedMaxArticles) : null;

    const response = await startSync({
      variables: {
        maxPages,
        maxArticles,
        pruneStale: syncPruneStale
      }
    });

    await refetchSyncStatus();

    const run = response.data?.startNewsbankSync;
    if (run?.status === "running") {
      setSyncMessage(`Sync run #${run.id} started.`);
    } else if (run) {
      setSyncMessage(`Sync run #${run.id} is already running.`);
    }
  };

  const buildTableVariables = (offset: number) => ({
    query: tableQuery.trim() ? tableQuery.trim() : null,
    tags: selectedTableTag ? [selectedTableTag] : null,
    limit: TABLE_PAGE_SIZE,
    offset
  });

  const currentTablePage = Math.floor(tableOffset / TABLE_PAGE_SIZE) + 1;

  const buildTableTagOptionsVariables = () => ({
    query: tableQuery.trim() ? tableQuery.trim() : null,
    tags: null,
    limit: 500,
    offset: 0
  });

  const getValidSelectedTag = (rows: Column[]) => {
    if (!selectedTableTag) return "";

    const selectedStillExists = rows.some((row) =>
      row.tags.some((tag) => tag.toLowerCase() === selectedTableTag.toLowerCase())
    );

    return selectedStillExists ? selectedTableTag : "";
  };

  const saveRowTags = async (row: Column, nextTagsOverride?: string[]) => {
    const nextTags =
      nextTagsOverride ?? parseTagInput(tableTagDrafts[row.id] ?? row.tags.join(", "));

    setSavingTagRowId(row.id);

    try {
      await updateColumnTags({
        variables: {
          id: row.id,
          tags: nextTags
        }
      });

      setTableTagDrafts((current) => ({
        ...current,
        [row.id]: nextTags.join(", ")
      }));

      const [tagOptionsResult] = await Promise.all([
        refetchTableTagOptions(buildTableTagOptionsVariables()),
        activeColumnId ? refetchNeighboringColumns({ id: activeColumnId, limit: 21 }) : Promise.resolve(),
        activeColumnId === row.id ? refetchActiveColumn({ id: row.id }) : Promise.resolve()
      ]);

      const optionRows = tagOptionsResult.data.searchColumns ?? [];
      const nextSelectedTag = getValidSelectedTag(optionRows);
      const nextOffset = nextSelectedTag ? tableOffset : 0;

      if (nextSelectedTag !== selectedTableTag) {
        setSelectedTableTag(nextSelectedTag);
      }
      if (nextOffset !== tableOffset) {
        setTableOffset(nextOffset);
      }

      await refetchTable({
        query: tableQuery.trim() ? tableQuery.trim() : null,
        tags: nextSelectedTag ? [nextSelectedTag] : null,
        limit: TABLE_PAGE_SIZE,
        offset: nextOffset
      });
    } finally {
      setSavingTagRowId(null);
    }
  };

  const saveActiveColumnTags = async (nextTags: string[]) => {
    if (!activeColumnId) return;

    setIsSavingActiveColumnTags(true);

    try {
      await updateColumnTags({
        variables: {
          id: activeColumnId,
          tags: nextTags
        }
      });

      setColumnTagDraft(nextTags.join(", "));

      const [tagOptionsResult] = await Promise.all([
        refetchActiveColumn({ id: activeColumnId }),
        refetchNeighboringColumns({ id: activeColumnId, limit: 21 }),
        refetchTableTagOptions(buildTableTagOptionsVariables())
      ]);

      const optionRows = tagOptionsResult.data.searchColumns ?? [];
      const nextSelectedTag = getValidSelectedTag(optionRows);
      const nextOffset = nextSelectedTag ? tableOffset : 0;

      if (nextSelectedTag !== selectedTableTag) {
        setSelectedTableTag(nextSelectedTag);
      }
      if (nextOffset !== tableOffset) {
        setTableOffset(nextOffset);
      }

      await refetchTable({
        query: tableQuery.trim() ? tableQuery.trim() : null,
        tags: nextSelectedTag ? [nextSelectedTag] : null,
        limit: TABLE_PAGE_SIZE,
        offset: nextOffset
      });
    } finally {
      setIsSavingActiveColumnTags(false);
    }
  };

  const saveActiveColumnTitle = async () => {
    if (!activeColumnId) return;

    const nextTitle = columnTitleDraft.trim();
    if (!nextTitle) return;

    await updateColumnTitle({
      variables: {
        id: activeColumnId,
        title: nextTitle
      }
    });

    await Promise.all([
      refetchActiveColumn({ id: activeColumnId }),
      refetchNeighboringColumns({ id: activeColumnId, limit: 21 }),
      refetchTable(buildTableVariables(tableOffset))
    ]);

    setIsEditingColumnTitle(false);
  };

  const jumpTableToDate = async () => {
    if (!tableJumpDate) return;

    const response = await fetchTablePageForDate({
      variables: {
        date: tableJumpDate,
        query: tableQuery.trim() ? tableQuery.trim() : null,
        tags: selectedTableTag ? [selectedTableTag] : null,
        pageSize: TABLE_PAGE_SIZE
      }
    });

    const page = Math.max(0, response.data?.searchColumnsPageForDate ?? 0);
    const nextOffset = page * TABLE_PAGE_SIZE;

    setTableOffset(nextOffset);
    await refetchTable(buildTableVariables(nextOffset));
  };

  const navigate = (nextView: View, nextColumnId: string | null, mode: "push" | "replace" = "push") => {
    setView(nextView);
    setActiveColumnId(nextView === "columns" ? nextColumnId : null);

    if (typeof window === "undefined") return;

    const nextHash = toHash(nextView, nextView === "columns" ? nextColumnId : null);
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
    const state = { view: nextView, columnId: nextView === "columns" ? nextColumnId : null };

    if (mode === "replace") {
      window.history.replaceState(state, "", nextUrl);
    } else {
      window.history.pushState(state, "", nextUrl);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    navigate(initialHashState.view, initialHashState.columnId, "replace");

    const onPopState = () => {
      const next = getHashState();
      setView(next.view);
      setActiveColumnId(next.view === "columns" ? next.columnId : null);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (view !== "columns" || activeColumnId) {
      return;
    }

    void fetchLatestColumn({
      variables: {
        query: null,
        tags: null,
        limit: 1,
        offset: 0
      }
    }).then((result) => {
      const latestColumnId = result.data?.searchColumns?.[0]?.id;
      if (!latestColumnId) {
        return;
      }

      navigate("columns", latestColumnId, "replace");
    });
  }, [view, activeColumnId, fetchLatestColumn]);

  const openColumnFromIndex = (columnId: string) => {
    navigate("columns", columnId);

    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  };

  const markRowAsDuplicate = async (row: Column) => {
    setMarkingDuplicateRowId(row.id);

    try {
      await markColumnDuplicate({
        variables: {
          id: row.id
        }
      });

      const [tagOptionsResult] = await Promise.all([
        refetchTableTagOptions(buildTableTagOptionsVariables()),
        activeColumnId ? refetchNeighboringColumns({ id: activeColumnId, limit: 21 }) : Promise.resolve(),
        refetchTable(buildTableVariables(tableOffset)),
        activeColumnId === row.id ? refetchActiveColumn({ id: row.id }) : Promise.resolve()
      ]);

      const optionRows = tagOptionsResult.data.searchColumns ?? [];
      const nextSelectedTag = getValidSelectedTag(optionRows);

      if (nextSelectedTag !== selectedTableTag) {
        setSelectedTableTag(nextSelectedTag);
        setTableOffset(0);
        await refetchTable({
          query: tableQuery.trim() ? tableQuery.trim() : null,
          tags: nextSelectedTag ? [nextSelectedTag] : null,
          limit: TABLE_PAGE_SIZE,
          offset: 0
        });
      }
    } finally {
      setMarkingDuplicateRowId(null);
    }
  };

  return (
    <div className="page">
      <header className="hero">
        <h1>Steve Duin Archive</h1>
        <p>Search and explore columns and mentions.</p>
      </header>

      <nav className="tabs" aria-label="Portal sections">
        <button
          className={view === "table" ? "tab active" : "tab"}
          onClick={() => navigate("table", null)}
        >
          Index
        </button>
        <button
          className={view === "columns" ? "tab active" : "tab"}
          onClick={() => navigate("columns", activeColumnId)}
        >
          Columns
        </button>
        <button
          className={view === "admin" ? "tab active" : "tab"}
          onClick={() => navigate("admin", null)}
        >
          Admin Portal
        </button>
      </nav>

      {view === "columns" ? (
        <section className="columns">
          {neighboringColumnsError && <p className="error">{neighboringColumnsError.message}</p>}
          {columnError && <p className="error">{columnError.message}</p>}
          {updateTitleError && <p className="error">{updateTitleError.message}</p>}

          <div className="columnsGrid">
            <aside className="columnIndex">
              <h2>Neighboring Columns</h2>
              {!activeColumnId && (
                <p>Select a column from Index to view nearby columns.</p>
              )}
              {activeColumnId && neighboringColumnsLoading && <p>Loading neighboring columns...</p>}
              {activeColumnId && !neighboringColumnsLoading && neighboringColumns.length === 0 && (
                <p>No neighboring columns found.</p>
              )}
              {neighboringColumns.map((column) => (
                <button
                  key={column.id}
                  className={activeColumnId === column.id ? "columnRow active" : "columnRow"}
                  onClick={() => navigate("columns", column.id)}
                >
                  <span className="columnRowTitle">{column.title}</span>
                  <span className="columnRowMeta">{column.date}</span>
                </button>
              ))}
            </aside>

            <article className="columnPage">
              {!activeColumnId && <p>Select a column from the index to view full text.</p>}
              {columnLoading && <p>Loading column...</p>}
              {activeColumn && (
                <>
                  <div className="columnTitleRow">
                    {isEditingColumnTitle ? (
                      <textarea
                        className="columnTitleInput"
                        value={columnTitleDraft}
                        onChange={(event) => setColumnTitleDraft(event.target.value)}
                        rows={3}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            void saveActiveColumnTitle();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setColumnTitleDraft(activeColumn.title);
                            setIsEditingColumnTitle(false);
                          }
                        }}
                        aria-label="Edit column title"
                      />
                    ) : (
                      <h2>{activeColumn.title}</h2>
                    )}

                    <div className="columnTitleActions">
                      {!isEditingColumnTitle ? (
                        <button
                          type="button"
                          className="editIconButton"
                          onClick={() => {
                            setColumnTitleDraft(activeColumn.title);
                            setIsEditingColumnTitle(true);
                          }}
                          aria-label="Edit headline"
                          title="Edit headline"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M4 20h4l10.5-10.5a1.4 1.4 0 0 0 0-2L16.5 5a1.4 1.4 0 0 0-2 0L4 15.5V20zm2-3.7 9.9-9.9 1.7 1.7L7.7 18H6v-1.7z" />
                          </svg>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="saveTitleButton"
                            onClick={() => void saveActiveColumnTitle()}
                            disabled={isSavingColumnTitle || !columnTitleDraft.trim() || columnTitleDraft.trim() === activeColumn.title}
                          >
                            {isSavingColumnTitle ? (
                              <span className="buttonSpinner" aria-hidden="true" />
                            ) : null}
                            <span>{isSavingColumnTitle ? "Saving" : "Save"}</span>
                          </button>
                          <button
                            type="button"
                            className="cancelTitleButton"
                            onClick={() => {
                              setColumnTitleDraft(activeColumn.title);
                              setIsEditingColumnTitle(false);
                            }}
                            disabled={isSavingColumnTitle}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="meta">
                    <span>{activeColumn.date}</span>
                  </div>
                  {(activeColumn.publicationName || activeColumn.byline || activeColumn.articleSection || activeColumn.wordCount) && (
                    <div className="meta">
                      {activeColumn.publicationName && <span>{activeColumn.publicationName}</span>}
                      {activeColumn.byline && <span>Byline: {activeColumn.byline}</span>}
                      {activeColumn.articleSection && <span>Section: {activeColumn.articleSection}</span>}
                      {activeColumn.wordCount && <span>{activeColumn.wordCount} words</span>}
                    </div>
                  )}
                  <div className="columnTagsPanel">
                    <p className="columnTagsTitle">Tags</p>
                    <div className="tagList">
                      {activeColumn.tags.length === 0 ? (
                        <span className="tagChipEmpty">No tags</span>
                      ) : (
                        activeColumn.tags.map((tag) => (
                          <button
                            key={`${activeColumn.id}-${tag}`}
                            type="button"
                            className="tagChipButton"
                            onClick={() =>
                              void saveActiveColumnTags(
                                activeColumn.tags.filter(
                                  (existingTag) =>
                                    existingTag.toLowerCase() !== tag.toLowerCase()
                                )
                              )
                            }
                            disabled={isSavingActiveColumnTags}
                            aria-label={`Remove tag ${tag}`}
                          >
                            <span>{tag}</span>
                            <span className="tagChipRemove">x</span>
                          </button>
                        ))
                      )}
                    </div>
                    <div className="tagEditor">
                      <input
                        value={columnTagDraft}
                        onChange={(event) => setColumnTagDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void saveActiveColumnTags(parseTagInput(columnTagDraft));
                          }
                        }}
                        placeholder="Add tags (comma separated)"
                      />
                      <button
                        onClick={() => void saveActiveColumnTags(parseTagInput(columnTagDraft))}
                        disabled={isSavingActiveColumnTags}
                      >
                        {isSavingActiveColumnTags ? "Saving..." : "Save Tags"}
                      </button>
                    </div>
                  </div>
                  {activeColumn.url && (
                    <p>
                      <a href={activeColumn.url} target="_blank" rel="noreferrer">
                        Open on Newsbank
                      </a>
                    </p>
                  )}
                  {showActiveColumnSnippet && (
                    <p className="columnSnippet">{activeColumn.snippet}</p>
                  )}
                  {activeColumn.bodyText ? (
                    <div className="columnBody">
                      {activeColumn.bodyText
                        .split(/\n{2,}/)
                        .filter((paragraph) => paragraph.trim().length > 0)
                        .map((paragraph, index) => (
                          <p key={`${activeColumn.id}-${index}`}>{paragraph.trim()}</p>
                        ))}
                    </div>
                  ) : (
                    <p>This column has no extracted body text yet.</p>
                  )}
                </>
              )}
            </article>
          </div>
        </section>
      ) : view === "table" ? (
        <section className="tableView">
          <div className="tablePagination tablePaginationTop">
            <div className="tablePageControls">
              <button
                onClick={() => {
                  const nextOffset = Math.max(0, tableOffset - TABLE_PAGE_SIZE);
                  setTableOffset(nextOffset);
                  void refetchTable(buildTableVariables(nextOffset));
                }}
                disabled={tableOffset === 0}
              >
                Previous
              </button>
              <span className="tablePageLabel">Page {currentTablePage}</span>
              <button
                onClick={() => {
                  const nextOffset = tableOffset + TABLE_PAGE_SIZE;
                  setTableOffset(nextOffset);
                  void refetchTable(buildTableVariables(nextOffset));
                }}
                disabled={sortedTableRows.length < TABLE_PAGE_SIZE}
              >
                Next
              </button>
            </div>

            <span className="tablePaginationDivider" aria-hidden="true" />

            <div className="tableDateJumpControls">
              <label className="tableJumpLabel">
                Jump To Date
                <input
                  type="date"
                  value={tableJumpDate}
                  onChange={(event) => setTableJumpDate(event.target.value)}
                />
              </label>
              <button onClick={() => void jumpTableToDate()} disabled={!tableJumpDate || tableJumpLoading}>
                {tableJumpLoading ? "Finding..." : "Go"}
              </button>
            </div>
          </div>

          <div className="tableToolbar">
            <div className="tableSearchInputWrap">
              <input
                value={tableQuery}
                onChange={(event) => setTableQuery(event.target.value)}
                placeholder="Search headline, snippet, body, or tags..."
              />
              {tableQuery && (
                <button
                  type="button"
                  className="tableSearchClearButton"
                  aria-label="Clear search"
                  onClick={() => {
                    setTableQuery("");
                    setTableOffset(0);
                    void refetchTable({
                      query: null,
                      tags: selectedTableTag ? [selectedTableTag] : null,
                      limit: TABLE_PAGE_SIZE,
                      offset: 0
                    });
                  }}
                >
                  x
                </button>
              )}
            </div>
            <select
              value={selectedTableTag}
              onChange={(event) => {
                const nextTag = event.target.value;
                setSelectedTableTag(nextTag);
                setTableOffset(0);
                void refetchTable({
                  query: tableQuery.trim() ? tableQuery.trim() : null,
                  tags: nextTag ? [nextTag] : null,
                  limit: TABLE_PAGE_SIZE,
                  offset: 0
                });
              }}
              aria-label="Filter by tag"
            >
              <option value="">All tags</option>
              {tableTagOptions.map((tagOption) => (
                <option key={tagOption.label.toLowerCase()} value={tagOption.label}>
                  {`${tagOption.label} (${tagOption.count})`}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setTableOffset(0);
                void refetchTable(buildTableVariables(0));
              }}
            >
              Apply Filter
            </button>
          </div>

          <div className="tableSummary">
            <p>
              Showing {sortedTableRows.length} row{sortedTableRows.length === 1 ? "" : "s"} starting at #
              {tableOffset + 1}.
            </p>
          </div>

          {tableError && <p className="error">{tableError.message}</p>}
          {updateTagsError && <p className="error">{updateTagsError.message}</p>}
          {markDuplicateError && <p className="error">{markDuplicateError.message}</p>}
          {tableJumpError && <p className="error">{tableJumpError.message}</p>}
          {tableLoading && <p>Loading table rows...</p>}

          {!tableLoading && sortedTableRows.length === 0 && <p>No rows found for this filter.</p>}

          {!tableLoading && sortedTableRows.length > 0 && (
            <>
              <div className="tableWrap">
                <table className="columnsTable">
                  <thead>
                    <tr>
                      <th>Headline</th>
                      <th>Date</th>
                      <th>Tags</th>
                      <th>Snippet</th>
                      <th>Newsbank</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTableRows.map((row) => (
                      <tr key={row.id}>
                        <td className="headlineCell">
                          <button
                            type="button"
                            className="headlineLinkButton"
                            onClick={() => openColumnFromIndex(row.id)}
                          >
                            {row.title}
                          </button>
                        </td>
                        <td>{row.date}</td>
                        <td>
                          <div className="tagCell">
                            <div className="tagList">
                              {row.tags.length === 0 ? (
                                <span className="tagChipEmpty">No tags</span>
                              ) : (
                                row.tags.map((tag) => (
                                  <button
                                    key={`${row.id}-${tag}`}
                                    type="button"
                                    className="tagChipButton"
                                    onClick={() =>
                                      void saveRowTags(
                                        row,
                                        row.tags.filter(
                                          (existingTag) =>
                                            existingTag.toLowerCase() !== tag.toLowerCase()
                                        )
                                      )
                                    }
                                    disabled={savingTagRowId === row.id}
                                    aria-label={`Remove tag ${tag}`}
                                  >
                                    <span>{tag}</span>
                                    <span className="tagChipRemove">x</span>
                                  </button>
                                ))
                              )}
                            </div>
                            <div className="tagEditor">
                              <input
                                value={tableTagDrafts[row.id] ?? row.tags.join(", ")}
                                onChange={(event) =>
                                  setTableTagDrafts((current) => ({
                                    ...current,
                                    [row.id]: event.target.value
                                  }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void saveRowTags(row);
                                  }
                                }}
                                placeholder="Add tags (comma separated)"
                              />
                              <button
                                onClick={() => void saveRowTags(row)}
                                disabled={savingTagRowId === row.id}
                              >
                                {savingTagRowId === row.id ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="snippetCell">{truncateWords(row.snippet, 15)}</td>
                        <td>
                          {row.url ? (
                            <a href={row.url} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="markDuplicateButton"
                            onClick={() => void markRowAsDuplicate(row)}
                            disabled={markingDuplicateRowId === row.id}
                          >
                            {markingDuplicateRowId === row.id ? "Marking..." : "Mark as Duplicate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="tablePagination">
                <button
                  onClick={() => {
                    const nextOffset = Math.max(0, tableOffset - TABLE_PAGE_SIZE);
                    setTableOffset(nextOffset);
                    void refetchTable(buildTableVariables(nextOffset));
                  }}
                  disabled={tableOffset === 0}
                >
                  Previous
                </button>
                <button
                  onClick={() => {
                    const nextOffset = tableOffset + TABLE_PAGE_SIZE;
                    setTableOffset(nextOffset);
                    void refetchTable(buildTableVariables(nextOffset));
                  }}
                  disabled={sortedTableRows.length < TABLE_PAGE_SIZE}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="admin">
          <h2>Newsbank Request Config</h2>
          <p>
            Paste the full cURL command from your browser network tab. This saves the latest request
            details, including your cookie header, for scraper usage.
          </p>

          <label htmlFor="curlInput" className="adminLabel">
            cURL command
          </label>
          <textarea
            id="curlInput"
            className="curlInput"
            value={curlInput}
            onChange={(event) => setCurlInput(event.target.value)}
            placeholder="curl 'https://...' -H 'cookie: ...' ..."
          />

          <div className="adminActions">
            <button onClick={() => void saveNewsbankCurl()} disabled={!curlInput.trim() || saveLoading}>
              {saveLoading ? "Saving..." : "Save Request"}
            </button>
          </div>

          <div className="syncPanel">
            <h3>NewsBank Sync</h3>
            <p>
              Start a tracked sync run and optionally remove stale NewsBank rows that are no longer in
              the latest fetched result set.
            </p>
            <p>Leave max pages or max articles blank to run an uncapped full sync.</p>

            <div className="syncControls">
              <label>
                Max pages
                <input
                  type="number"
                  min={1}
                  placeholder="Full sync"
                  value={syncMaxPages}
                  onChange={(event) => setSyncMaxPages(event.target.value)}
                />
              </label>
              <label>
                Max articles
                <input
                  type="number"
                  min={1}
                  placeholder="Full sync"
                  value={syncMaxArticles}
                  onChange={(event) => setSyncMaxArticles(event.target.value)}
                />
              </label>
              <label className="checkboxRow">
                <input
                  type="checkbox"
                  checked={syncPruneStale}
                  onChange={(event) => setSyncPruneStale(event.target.checked)}
                />
                Prune stale NewsBank rows after run
              </label>
            </div>

            <div className="adminActions">
              <button
                onClick={() => void startNewsbankSync()}
                disabled={startSyncLoading || syncStatus.isRunning}
              >
                {syncStatus.isRunning
                  ? "Sync In Progress"
                  : startSyncLoading
                    ? "Starting..."
                    : "Start Sync"}
              </button>
            </div>

            {syncStatusLoading && <p>Loading sync status...</p>}
            {syncMessage && <p className="success">{syncMessage}</p>}
            {startSyncError && <p className="error">{startSyncError.message}</p>}
            {syncStatusError && <p className="error">{syncStatusError.message}</p>}

            {statusRun && (
              <div className="syncStatusCard">
                <p>
                  <strong>Run #{statusRun.id}</strong> · {statusRun.status}
                </p>
                <p>
                  <strong>Progress:</strong> {statusRun.processedCount}/{statusRun.totalDiscovered} (
                  {statusRun.progressPercent}%)
                </p>
                <div className="progressBar" role="progressbar" aria-valuenow={statusRun.progressPercent}>
                  <div className="progressFill" style={{ width: `${statusRun.progressPercent}%` }} />
                </div>
                <p>
                  <strong>Inserted:</strong> {statusRun.insertedCount} · <strong>Updated:</strong>{" "}
                  {statusRun.updatedCount} · <strong>Skipped existing:</strong>{" "}
                  {statusRun.skippedExistingCount} · <strong>Failed:</strong> {statusRun.failedCount}
                </p>
                <p>
                  <strong>Stale deleted:</strong> {statusRun.deletedStaleCount}
                </p>
                <p>
                  <strong>Started:</strong> {new Date(statusRun.startedAt).toLocaleString()}
                </p>
                {statusRun.finishedAt && (
                  <p>
                    <strong>Finished:</strong> {new Date(statusRun.finishedAt).toLocaleString()}
                  </p>
                )}
                {statusRun.errorMessage && <p className="error">{statusRun.errorMessage}</p>}
              </div>
            )}
          </div>

          {saveMessage && <p className="success">{saveMessage}</p>}
          {saveError && <p className="error">{saveError.message}</p>}
          {configError && <p className="error">{configError.message}</p>}
          {configLoading && <p>Loading saved config...</p>}

          {activeConfig && (
            <div className="configSummary">
              <h3>Saved Request Snapshot</h3>
              <p>
                <strong>Method:</strong> {activeConfig.method}
              </p>
              <p>
                <strong>URL:</strong> {activeConfig.requestUrl ?? "Not detected"}
              </p>
              <p>
                <strong>Cookie header:</strong>{" "}
                {activeConfig.cookieHeader ? "Captured" : "Not detected"}
              </p>
              <p>
                <strong>Last updated:</strong> {new Date(activeConfig.updatedAt).toLocaleString()}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default App;
