/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { ErrorCard } from "@components/ErrorCard";
import { Heading } from "@components/Heading";
import { DeleteIcon } from "@components/Icons";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { HashLink } from "@components/settings/tabs/updater/Components";
import { FLOCORD_VERSION, versionGt } from "@flocordplugins/FlocordAutoUpdater/version";
import { Margins } from "@utils/margins";
import { useAwaiter } from "@utils/react";
import { type PluginNative } from "@utils/types";
import { getRepo, UpdateLogger } from "@utils/updater";
import { Alerts, React, Toasts } from "@webpack/common";

import gitHash from "~git-hash";

import {
    ChangelogEntry,
    ChangelogHistory,
    clearChangelogHistory,
    clearIndividualLog,
    formatTimestamp,
    getChangelogHistory,
    getCommitsSinceLastSeen,
    getLastRepositoryCheckHash,
    getNewPlugins,
    getNewSettings,
    getNewSettingsEntries,
    getNewSettingsSize,
    getUpdatedPlugins,
    initializeChangelog,
    saveUpdateSession,
    UpdateSession,
} from "./changelogManager";
import { NewPluginsCompact, NewPluginsSection } from "./NewPluginsSection";

const AutoUpdater = FlocordNative.pluginHelpers.FlocordAutoUpdater as PluginNative<
    typeof import("@flocordplugins/FlocordAutoUpdater/native")
>;

function ChangelogCard({
    entry,
    repo,
    repoPending,
}: {
    entry: ChangelogEntry;
    repo: string;
    repoPending: boolean;
}) {
    return (
        <Card className="vc-changelog-entry">
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25em",
                }}
            >
                <div className="vc-changelog-entry-header">
                    <code className="vc-changelog-entry-hash">
                        <HashLink
                            repo={repo}
                            hash={entry.hash}
                            disabled={repoPending}
                        />
                    </code>
                    <span className="vc-changelog-entry-author">
                        by {entry.author}
                    </span>
                </div>
                <div className="vc-changelog-entry-message">
                    {entry.message}
                </div>
            </div>
        </Card>
    );
}

function UpdateLogCard({
    log,
    repo,
    repoPending,
    isExpanded,
    onToggleExpand,
    onClearLog,
}: {
    log: UpdateSession;
    repo: string;
    repoPending: boolean;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onClearLog: (logId: string) => void;
}) {
    const isRepositoryFetch =
        log.type === "repository_fetch" ||
        (log.type === undefined &&
            log.fromHash === log.toHash &&
            log.commits.length === 0);
    const isUpToDate = log.fromHash === log.toHash;

    return (
        <Card className="vc-changelog-log">
            <div className="vc-changelog-log-header" onClick={onToggleExpand}>
                <div className="vc-changelog-log-info">
                    <div className="vc-changelog-log-title">
                        <span>
                            {isRepositoryFetch
                                ? isUpToDate
                                    ? `Repository check: ${log.fromHash.slice(0, 7)} (up to date)`
                                    : `Repository check: ${log.fromHash.slice(0, 7)} → ${log.toHash.slice(0, 7)}`
                                : `Update: ${log.fromHash.slice(0, 7)} → ${log.toHash.slice(0, 7)}`}
                        </span>
                        <Button
                            size="min"
                            variant="secondary"
                            className="vc-changelog-delete-button"
                            style={{
                                padding: "4px",
                                color: "var(--status-danger)",
                                opacity: 0.6,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                            onClick={e => {
                                e.stopPropagation();
                                onClearLog(log.id);
                            }}
                        >
                            <DeleteIcon width={16} height={16} />
                        </Button>
                    </div>
                    <div className="vc-changelog-log-meta">
                        {formatTimestamp(log.timestamp)}
                        {log.commits.length > 0 &&
                            ` • ${log.commits.length} commits available`}
                        {log.commits.length === 0 && " • No new commits"}
                        {log.newPlugins.length > 0 &&
                            ` • ${log.newPlugins.length} new plugins`}
                        {log.updatedPlugins.length > 0 &&
                            ` • ${log.updatedPlugins.length} updated plugins`}
                        {log.newSettings &&
                            getNewSettingsSize(log.newSettings) > 0 &&
                            ` • ${getNewSettingsEntries(log.newSettings).reduce((sum, [, arr]) => sum + arr.length, 0)} new settings`}
                    </div>
                </div>
                <div
                    className={`vc-changelog-log-toggle ${isExpanded ? "expanded" : ""}`}
                >
                    ▼
                </div>
            </div>

            {isExpanded && (
                <div className="vc-changelog-log-content">
                    {log.newPlugins.length > 0 && (
                        <div className="vc-changelog-log-plugins">
                            <NewPluginsCompact
                                newPlugins={log.newPlugins}
                                maxDisplay={50}
                            />
                        </div>
                    )}

                    {log.updatedPlugins.length > 0 && (
                        <div className="vc-changelog-log-plugins">
                            <Heading className={Margins.bottom8}>
                                Updated Plugins
                            </Heading>
                            <NewPluginsCompact
                                newPlugins={log.updatedPlugins}
                                maxDisplay={50}
                            />
                        </div>
                    )}

                    {log.newSettings &&
                        getNewSettingsSize(log.newSettings) > 0 && (
                            <div className="vc-changelog-log-plugins">
                                <Heading className={Margins.bottom8}>
                                    New Settings
                                </Heading>
                                <div className="vc-changelog-new-plugins-list">
                                    {getNewSettingsEntries(log.newSettings).map(
                                        ([pluginName, settings]) =>
                                            settings.map(setting => (
                                                <span
                                                    key={`${pluginName}-${setting}`}
                                                    className="vc-changelog-new-plugin-tag"
                                                    title={`New setting in ${pluginName}`}
                                                >
                                                    {pluginName}.{setting}
                                                </span>
                                            )),
                                    )}
                                </div>
                            </div>
                        )}

                    {log.commits.length > 0 && (
                        <div className="vc-changelog-log-commits">
                            <div className="vc-changelog-log-commits-list">
                                {log.commits.map(entry => (
                                    <ChangelogCard
                                        key={entry.hash}
                                        entry={entry}
                                        repo={repo}
                                        repoPending={repoPending}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}

function ChangelogContent() {
    const [repo, repoErr, repoPending] = useAwaiter(getRepo, {
        fallbackValue: "Loading...",
    });
    const [changelog, setChangelog] = React.useState<ChangelogEntry[]>([]);
    const [changelogHistory, setChangelogHistory] =
        React.useState<ChangelogHistory>([]);
    const [newPlugins, setNewPlugins] = React.useState<string[]>([]);
    const [updatedPlugins, setUpdatedPlugins] = React.useState<string[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [expandedLogs, setExpandedLogs] = React.useState<Set<string>>(
        new Set(),
    );
    const [showHistory, setShowHistory] = React.useState(false);
    const [availableVersion, setAvailableVersion] = React.useState<string | null>(
        null,
    );
    const [isVersionChecking, setIsVersionChecking] = React.useState(true);
    const [checkSummary, setCheckSummary] = React.useState<string | null>(null);
    const [lastCheckedAt, setLastCheckedAt] = React.useState<number | null>(null);

    React.useEffect(() => {
        const init = async () => {
            try {
                await initializeChangelog();
                await loadChangelogHistory();
            } catch (err) {
                console.error("Failed to initialize changelog:", err);
            }
        };
        init();
    }, []);

    React.useEffect(() => {
        if (repoErr) {
            UpdateLogger.error("Failed to retrieve repo", repoErr);
            setError("Failed to retrieve repository information");
        }
    }, [repoErr]);

    const loadChangelogHistory = React.useCallback(async () => {
        try {
            const history = await getChangelogHistory();
            setChangelogHistory(history);
        } catch (err) {
            console.error("Failed to load changelog history:", err);
        }
    }, []);

    const loadNewPlugins = React.useCallback(async () => {
        try {
            const newPlgs = await getNewPlugins();
            const updatedPlgs = await getUpdatedPlugins();
            setNewPlugins(newPlgs);
            setUpdatedPlugins(updatedPlgs);
        } catch (err) {
            console.error("Failed to load new plugins:", err);
        }
    }, []);

    const refreshAvailableVersion = React.useCallback(async () => {
        setIsVersionChecking(true);

        try {
            const info = await AutoUpdater.fetchVersionInfo();
            const version = info?.version ?? null;
            setAvailableVersion(version);
            return version;
        } catch (err) {
            UpdateLogger.error("Failed to fetch latest client version", err);
            setAvailableVersion(null);
            return null;
        } finally {
            setIsVersionChecking(false);
        }
    }, []);

    const ensureLocalUpdateLogged = React.useCallback(async () => {
        if (repoPending || repoErr) return false;
        const repoUrl = repo;
        if (!repoUrl) return false;

        try {
            const commits = await getCommitsSinceLastSeen(repoUrl);
            if (commits.length === 0) return false;

            const newPlgs = await getNewPlugins();
            const updatedPlgs = await getUpdatedPlugins();
            const newSettings = await getNewSettings();

            await saveUpdateSession(commits, newPlgs, updatedPlgs, newSettings);

            setChangelog(commits);
            setNewPlugins(newPlgs);
            setUpdatedPlugins(updatedPlgs);
            await loadChangelogHistory();
            return true;
        } catch (err) {
            console.error("Failed to log local update:", err);
            return false;
        }
    }, [repo, repoErr, repoPending, loadChangelogHistory]);

    const fetchChangelog = React.useCallback(async () => {
        if (repoPending || repoErr) return;

        setIsLoading(true);
        setError(null);
        setCheckSummary(null);

        try {
            const versionRequest = refreshAvailableVersion();
            const updates = await FlocordNative.updater.getUpdates();
            const latestVersion = await versionRequest;

            if (!updates.ok) {
                throw new Error(
                    updates.error?.message || "Failed to fetch from repository",
                );
            }

            const lastRepoCheck = await getLastRepositoryCheckHash();
            const currentRepoHash = updates.value[0]?.hash ?? gitHash;
            const isNewRepositoryState = lastRepoCheck !== currentRepoHash;

            if (updates.value.length > 0) {
                setChangelog(updates.value);

                const newPlgs = await getNewPlugins();
                const updatedPlgs = await getUpdatedPlugins();
                const newSettings = await getNewSettings();
                setNewPlugins(newPlgs);
                setUpdatedPlugins(updatedPlgs);

                await saveUpdateSession(
                    updates.value,
                    newPlgs,
                    updatedPlgs,
                    newSettings,
                    true,
                );
                await loadChangelogHistory();

                if (isNewRepositoryState) {
                    Toasts.show({
                        message: `Found ${updates.value.length} commit${updates.value.length === 1 ? "" : "s"} from repository`,
                        id: Toasts.genId(),
                        type: Toasts.Type.SUCCESS,
                        options: {
                            position: Toasts.Position.BOTTOM,
                        },
                    });
                }
            } else {
                const logged = await ensureLocalUpdateLogged();
                if (!logged) {
                    setChangelog([]);
                    setNewPlugins([]);
                    setUpdatedPlugins([]);
                } else {
                    Toasts.show({
                        message: "Logged commits from your latest update",
                        id: Toasts.genId(),
                        type: Toasts.Type.SUCCESS,
                        options: {
                            position: Toasts.Position.BOTTOM,
                        },
                    });
                }
            }

            const versionStatus = latestVersion === null
                ? "The latest client release could not be checked."
                : versionGt(latestVersion, FLOCORD_VERSION)
                    ? `Update available: v${latestVersion} (installed: v${FLOCORD_VERSION}).`
                    : versionGt(FLOCORD_VERSION, latestVersion)
                        ? `Installed v${FLOCORD_VERSION} is newer than the latest release, v${latestVersion}.`
                        : `Client up to date: v${FLOCORD_VERSION} installed; v${latestVersion} available.`;
            const repositoryStatus = updates.value.length > 0
                ? `${updates.value.length} repository commit${updates.value.length === 1 ? "" : "s"} differ from this installation.`
                : `No repository commits are ahead of ${gitHash.slice(0, 7)}.`;

            setCheckSummary(`${versionStatus} ${repositoryStatus}`);
            setLastCheckedAt(Date.now());
        } catch (err: any) {
            UpdateLogger.error("Failed to fetch commits from repository", err);
            const errorMessage =
                err?.message ||
                "Failed to connect to repository. Check your internet connection.";
            setError(errorMessage);

            // funny little error toast hopefully doesn't happen!
            Toasts.show({
                message: "Could not fetch commits from repository",
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
                options: {
                    position: Toasts.Position.BOTTOM,
                },
            });
        } finally {
            setIsLoading(false);
        }
    }, [
        repoPending,
        repoErr,
        refreshAvailableVersion,
        ensureLocalUpdateLogged,
        loadChangelogHistory,
    ]);

    React.useEffect(() => {
        const loadInitialData = async () => {
            if (!repoPending && !repoErr) {
                await loadNewPlugins();
                const logged = await ensureLocalUpdateLogged();
                if (!logged) {
                    await fetchChangelog();
                } else {
                    await refreshAvailableVersion();
                    setIsLoading(false);
                }
            } else if (!repoPending) {
                // perseverance
                await loadNewPlugins();
                await refreshAvailableVersion();
                setIsLoading(false);
            }
        };
        loadInitialData();
    }, [
        repoPending,
        repoErr,
        fetchChangelog,
        loadNewPlugins,
        ensureLocalUpdateLogged,
        refreshAvailableVersion,
    ]);

    const toggleLogExpanded = (logId: string) => {
        const newExpanded = new Set(expandedLogs);
        if (newExpanded.has(logId)) {
            newExpanded.delete(logId);
        } else {
            newExpanded.add(logId);
        }
        setExpandedLogs(newExpanded);
    };

    const hasCurrentChanges =
        changelog.length > 0 ||
        newPlugins.length > 0 ||
        updatedPlugins.length > 0;
    const isReleaseUpdateAvailable =
        availableVersion !== null &&
        versionGt(availableVersion, FLOCORD_VERSION);
    const isInstalledVersionNewer =
        availableVersion !== null &&
        versionGt(FLOCORD_VERSION, availableVersion);

    return (
        <>
            <Heading className={Margins.top16}>Fetch Changes</Heading>
            <Paragraph className={Margins.bottom16}>
                Compare the installed client with the latest release, then check the repository for new commits and plugin changes.
            </Paragraph>

            <Card className="vc-changelog-version-summary">
                <div className="vc-changelog-version-comparison">
                    <div className="vc-changelog-version-item">
                        <span className="vc-changelog-version-label">Installed client</span>
                        <strong className="vc-changelog-version-value">
                            v{FLOCORD_VERSION}
                        </strong>
                        <code className="vc-changelog-version-hash">
                            {gitHash.slice(0, 7)}
                        </code>
                    </div>
                    <span className="vc-changelog-version-arrow" aria-hidden="true">
                        →
                    </span>
                    <div className="vc-changelog-version-item">
                        <span className="vc-changelog-version-label">Latest available</span>
                        <strong className="vc-changelog-version-value">
                            {isVersionChecking
                                ? "Checking…"
                                : availableVersion
                                    ? `v${availableVersion}`
                                    : "Unavailable"}
                        </strong>
                    </div>
                </div>
                <div
                    className={`vc-changelog-version-status ${isReleaseUpdateAvailable ? "update-available" : ""} ${!isReleaseUpdateAvailable && !isInstalledVersionNewer && availableVersion ? "up-to-date" : ""}`}
                    role="status"
                    aria-live="polite"
                >
                    {isVersionChecking
                        ? "Checking the latest signed release…"
                        : availableVersion === null
                            ? "Could not check the latest client release."
                            : isReleaseUpdateAvailable
                                ? `Version v${availableVersion} is available.`
                                : isInstalledVersionNewer
                                    ? `Installed v${FLOCORD_VERSION} is newer than the latest release.`
                                    : "Your client is up to date."}
                </div>
            </Card>

            <div className="vc-changelog-controls">
                <Button
                    size="small"
                    disabled={isLoading || repoPending || !!repoErr}
                    onClick={fetchChangelog}
                    variant="primary"
                >
                    {isLoading ? "Checking..." : lastCheckedAt ? "Check again" : "Check for updates"}
                </Button>

                {changelogHistory.length > 0 && (
                    <>
                        <Button
                            size="small"
                            variant={showHistory ? "primary" : "secondary"}
                            onClick={() => setShowHistory(!showHistory)}
                            style={{ marginLeft: "8px" }}
                        >
                            {showHistory ? "Hide Logs" : "Show Logs"}
                        </Button>
                        <Button
                            size="small"
                            variant="dangerPrimary"
                            onClick={() => {
                                Alerts.show({
                                    title: "Clear All Logs",
                                    body: "Are you sure you would like to clear all logs? This can't be undone.",
                                    confirmText: "Clear All",
                                    confirmColor: "danger",
                                    cancelText: "Cancel",
                                    onConfirm: async () => {
                                        await clearChangelogHistory();
                                        await loadChangelogHistory();
                                        setShowHistory(false);
                                        Toasts.show({
                                            message: "All logs have been cleared",
                                            id: Toasts.genId(),
                                            type: Toasts.Type.SUCCESS,
                                            options: {
                                                position: Toasts.Position.BOTTOM,
                                            },
                                        });
                                    },
                                });
                            }}
                            style={{ marginLeft: "8px" }}
                        >
                            Clear All Logs
                        </Button>
                    </>
                )}
            </div>

            {checkSummary && (
                <div className="vc-changelog-check-summary" role="status" aria-live="polite">
                    <Paragraph>{checkSummary}</Paragraph>
                    {lastCheckedAt !== null && (
                        <span className="vc-changelog-last-checked">
                            Last checked at {new Date(lastCheckedAt).toLocaleTimeString()}.
                        </span>
                    )}
                </div>
            )}

            {error && (
                <ErrorCard style={{ padding: "1em", marginTop: "1em" }}>
                    <Paragraph>{error}</Paragraph>
                    <Paragraph color="text-subtle" style={{ marginTop: "0.5em" }}>
                        Make sure you have an internet connection and try again.
                    </Paragraph>
                </ErrorCard>
            )}

            <Divider className={Margins.top20} />

            <Heading className={Margins.top20}>Repository</Heading>
            <Paragraph className={Margins.bottom8}>
                This is the GitHub repository where Flocord fetches updates from.
            </Paragraph>
            <Paragraph color="text-subtle">
                {repoPending ? (
                    repo
                ) : repoErr ? (
                    "Failed to retrieve - check console"
                ) : (
                    <Link href={repo}>
                        {repo.split("/").slice(-2).join("/")}
                    </Link>
                )}
                {" "}(<HashLink repo={repo} hash={gitHash} disabled={repoPending} />)
            </Paragraph>

            {hasCurrentChanges && (
                <>
                    <Divider className={Margins.top20} />

                    <Heading className={Margins.top20}>Recent Changes</Heading>
                    <Paragraph className={Margins.bottom16}>
                        These are the new commits and plugin updates since your last version. You can see what features were added, bugs were fixed, and which plugins received updates.
                    </Paragraph>

                    {newPlugins.length > 0 && (
                        <div className={Margins.bottom16}>
                            <NewPluginsSection
                                newPlugins={newPlugins}
                                onPluginToggle={() => { }}
                            />
                        </div>
                    )}

                    {updatedPlugins.length > 0 && (
                        <div className={Margins.bottom16}>
                            <Heading className={Margins.bottom8}>
                                Updated Plugins ({updatedPlugins.length})
                            </Heading>
                            <NewPluginsCompact newPlugins={updatedPlugins} />
                        </div>
                    )}

                    {changelog.length > 0 && (
                        <div>
                            <Heading className={Margins.bottom8}>
                                Code Changes ({changelog.length} {changelog.length === 1 ? "commit" : "commits"})
                            </Heading>
                            <div className="vc-changelog-commits-list">
                                {changelog.map(entry => (
                                    <ChangelogCard
                                        key={entry.hash}
                                        entry={entry}
                                        repo={repo}
                                        repoPending={repoPending}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {!hasCurrentChanges && !isLoading && !error && (
                <>
                    <Divider className={Margins.top20} />
                    <Heading className={Margins.top20}>Recent Changes</Heading>
                    <Paragraph color="text-subtle">
                        No commits were found beyond the installed revision. The version comparison above shows whether a newer client release is available.
                    </Paragraph>
                </>
            )}

            {showHistory && changelogHistory.length > 0 && (
                <>
                    <Divider className={Margins.top20} />

                    <Heading className={Margins.top20}>
                        Update Logs ({changelogHistory.length} {changelogHistory.length === 1 ? "log" : "logs"})
                    </Heading>
                    <Paragraph className={Margins.bottom16}>
                        A history of your previous update sessions with their commit history and plugin changes. Click on a log to expand it and see the details.
                    </Paragraph>

                    <div className="vc-changelog-history-list">
                        {changelogHistory.map(log => (
                            <UpdateLogCard
                                key={log.id}
                                log={log}
                                repo={repo}
                                repoPending={repoPending}
                                isExpanded={expandedLogs.has(log.id)}
                                onToggleExpand={() => toggleLogExpanded(log.id)}
                                onClearLog={logId => {
                                    Alerts.show({
                                        title: "Clear Log",
                                        body: "Are you sure you would like to clear this log? This can't be undone.",
                                        confirmText: "Clear Log",
                                        confirmColor: "danger",
                                        cancelText: "Cancel",
                                        onConfirm: async () => {
                                            await clearIndividualLog(logId);
                                            await loadChangelogHistory();
                                            setExpandedLogs(
                                                new Set(
                                                    Array.from(expandedLogs).filter(id => id !== logId),
                                                ),
                                            );
                                            Toasts.show({
                                                message: "Log has been cleared",
                                                id: Toasts.genId(),
                                                type: Toasts.Type.SUCCESS,
                                                options: {
                                                    position: Toasts.Position.BOTTOM,
                                                },
                                            });
                                        },
                                    });
                                }}
                            />
                        ))}
                    </div>
                </>
            )}
        </>
    );
}

function ChangelogTab() {
    return (
        <SettingsTab>
            <ChangelogContent />
        </SettingsTab>
    );
}

export default wrapTab(ChangelogTab, "Changelog");
