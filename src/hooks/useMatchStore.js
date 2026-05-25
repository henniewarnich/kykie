import { useState, useCallback, useEffect } from 'react';
import { loadData, saveData } from '../utils/helpers.js';
import { supabase } from '../utils/supabase.js';
import { upsertTeam as upsertTeamRemote, deleteTeamRemote, fetchTeams, saveMatchToSupabase, deleteMatchRemote, fetchMatchesForLocal } from '../utils/sync.js';

const TEAMS_KEY = 'kykie-teams';
const GAMES_KEY = 'kykie-games';

// Persist only unsynced games to localStorage. Synced games live in the cloud
// and re-hydrate on next load — keeping the local cache small protects the
// localStorage quota and prevents in-progress recordings from breaking when
// the synced backlog grows large.
function saveUnsyncedGames(games) {
  saveData(GAMES_KEY, (games || []).filter(g => !g.supabase_id));
}

export function useMatchStore() {
  const [teams, setTeams] = useState(() => loadData(TEAMS_KEY, []));
  const [games, setGames] = useState(() => loadData(GAMES_KEY, []));
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState(null);

  // On mount: try to pull teams from Supabase (merge with local)
  useEffect(() => {
    fetchTeams().then(remote => {
      if (!remote) return;
      setTeams(prev => {
        const merged = mergeTeams(prev, remote);
        saveData(TEAMS_KEY, merged);
        return merged;
      });
    }).catch(() => {});

    // Also pull games from Supabase (merge with local)
    fetchMatchesForLocal().then(remote => {
      if (!remote || remote.length === 0) return;
      setGames(prev => {
        const merged = mergeGames(prev, remote);
        saveUnsyncedGames(merged);
        return merged;
      });
    }).catch(() => {});
  }, []);

  // When a sync self-heals a local-only team id, remap the local team record
  // to the cloud UUID so the next match (and the team picker) use the right id.
  const applyTeamIdRemap = useCallback((remap) => {
    if (!remap || Object.keys(remap).length === 0) return;
    setTeams(prev => {
      const updated = prev.map(t =>
        remap[t.id] ? { ...t, id: remap[t.id], supabase_id: remap[t.id] } : t
      );
      saveData(TEAMS_KEY, updated);
      return updated;
    });
  }, []);

  // Team CRUD — local first, then sync
  const saveTeam = useCallback((team) => {
    // Optimistic local update. Identity comes from id + institution; no name field.
    setTeams(prev => {
      let updated;
      if (team.id) {
        updated = prev.map(t => t.id === team.id ? { ...t, ...team } : t);
      } else {
        updated = [...prev, { ...team, id: Date.now().toString() }];
      }
      saveData(TEAMS_KEY, updated);
      return updated;
    });

    // Sync to Supabase — response includes institution join
    upsertTeamRemote(team).then(remote => {
      if (remote) {
        setTeams(prev => {
          const updated = prev.map(t =>
            (t.id === remote.id || t.id === team.id || t.supabase_id === remote.id)
              ? { ...remote, supabase_id: remote.id }
              : t
          );
          saveData(TEAMS_KEY, updated);
          return updated;
        });
      } else {
        // upsertTeam returned null — a Supabase error was logged inside it but
        // the team is now stranded with a local-only id. Surface it so the user
        // knows to retry; otherwise the next match against this team can't sync.
        setLastSyncError('Team saved locally but cloud sync failed. Open Teams and re-save before recording.');
      }
    }).catch(err => {
      console.warn('Team upsert failed:', err);
      setLastSyncError('Team save failed: ' + (err?.message || 'unknown error'));
    });
  }, []);

  const deleteTeam = useCallback((id) => {
    const team = teams.find(t => t.id === id);
    setTeams(prev => {
      const updated = prev.filter(t => t.id !== id);
      saveData(TEAMS_KEY, updated);
      return updated;
    });
    // Sync delete
    if (team?.supabase_id) {
      deleteTeamRemote(team.supabase_id).catch(() => {});
    }
  }, [teams]);

  // Game CRUD — save locally, then sync to Supabase
  const saveGame = useCallback((game) => {
    setGames(prev => {
      const updated = [game, ...prev];
      saveUnsyncedGames(updated);
      return updated;
    });

    // Sync match + events to Supabase (fire-and-forget)
    setSyncing(true);
    setLastSyncError(null);
    saveMatchToSupabase(game).then(remote => {
      setSyncing(false);
      if (remote) {
        applyTeamIdRemap(remote._teamIdRemap);
        // Store Supabase match ID on the local game
        setGames(prev => {
          const updated = prev.map(g =>
            g.id === game.id ? { ...g, supabase_id: remote.id } : g
          );
          saveUnsyncedGames(updated);
          return updated;
        });
      } else {
        setLastSyncError('Match saved locally but cloud sync failed. Will retry next time.');
      }
    }).catch(err => {
      setSyncing(false);
      setLastSyncError('Offline — match saved locally.');
      console.warn('Sync failed:', err);
    });

    return game;
  }, []);

  const deleteGame = useCallback(async (id) => {
    const game = games.find(g => g.id === id);
    setGames(prev => {
      const updated = prev.filter(g => g.id !== id);
      saveUnsyncedGames(updated);
      return updated;
    });

    // Try to delete from Supabase using all possible IDs
    const idsToTry = [game?.supabase_id, game?.id].filter(Boolean);
    let deleted = false;
    for (const tryId of idsToTry) {
      try {
        const { error } = await supabase.from('matches').delete().eq('id', tryId);
        if (!error) { deleted = true; break; }
        console.warn(`Delete by id=${tryId} failed:`, error.message);
      } catch (err) {
        console.warn(`Delete by id=${tryId} threw:`, err);
      }
    }
    if (!deleted && idsToTry.length > 0) {
      setLastSyncError(`Failed to delete match from cloud. You may need to delete it manually in Supabase.`);
      console.error('All delete attempts failed for game:', game);
    }
  }, [games]);

  // Remove from local storage only (when Supabase delete is handled separately)
  const deleteGameLocal = useCallback((id) => {
    setGames(prev => {
      const updated = prev.filter(g => g.id !== id);
      saveUnsyncedGames(updated);
      return updated;
    });
  }, []);

  // Force sync all unsynced games to Supabase
  const syncAllGames = useCallback(async () => {
    const unsynced = games.filter(g => !g.supabase_id);
    if (unsynced.length === 0) return { synced: 0, failed: 0 };

    setSyncing(true);
    setLastSyncError(null);
    let synced = 0, failed = 0;

    for (const game of unsynced) {
      try {
        const remote = await saveMatchToSupabase(game);
        if (remote) {
          applyTeamIdRemap(remote._teamIdRemap);
          setGames(prev => {
            const updated = prev.map(g => g.id === game.id ? { ...g, supabase_id: remote.id } : g);
            saveUnsyncedGames(updated);
            return updated;
          });
          synced++;
        } else {
          failed++;
        }
      } catch (err) {
        console.warn('Sync game failed:', err);
        failed++;
      }
    }

    setSyncing(false);
    if (failed > 0) setLastSyncError(`${failed} game(s) failed to sync.`);
    return { synced, failed };
  }, [games]);

  return { teams, games, saveTeam, deleteTeam, saveGame, deleteGame, deleteGameLocal, syncAllGames, syncing, lastSyncError };
}

// Merge local and remote teams (remote wins for name conflicts)
function mergeTeams(local, remote) {
  // Remote is source of truth — start with full remote data (includes institution joins)
  const merged = remote.map(rt => ({
    ...rt,
    supabase_id: rt.id,
  }));

  // Add any local-only teams (not yet in Supabase). Match on id only —
  // the legacy name-based duplicate check was removed when the `name` column
  // was dropped.
  for (const lt of local) {
    if (lt.supabase_id) continue;
    const inRemote = merged.find(t => t.id === lt.id);
    if (!inRemote) merged.push(lt);
  }

  return merged;
}

// Merge local and remote games — remote is source of truth for synced games
function mergeGames(local, remote) {
  const remoteIds = new Set(remote.map(r => r.supabase_id || r.id));

  // Start with local games that are either unsynced OR still exist in remote
  const kept = local.filter(g => {
    if (!g.supabase_id) return true; // unsynced — keep it, it's local-only
    return remoteIds.has(g.supabase_id); // synced — only keep if still in Supabase
  });

  // Now merge remote into kept. Fallback duplicate-detection uses institution_id
  // since the legacy team.name column was dropped.
  for (const rg of remote) {
    const existing = kept.find(g =>
      g.supabase_id === rg.supabase_id ||
      g.id === rg.id ||
      (g.teams?.home?.institution_id && g.teams?.home?.institution_id === rg.teams?.home?.institution_id &&
       g.teams?.away?.institution_id === rg.teams?.away?.institution_id &&
       g.date?.slice(0, 10) === rg.date?.slice(0, 10))
    );
    if (existing) {
      existing.supabase_id = rg.supabase_id;
      existing.homeScore = rg.homeScore;
      existing.awayScore = rg.awayScore;
      existing.venue = rg.venue || existing.venue;
      existing.matchLength = rg.matchLength || existing.matchLength;
      existing.breakFormat = rg.breakFormat || existing.breakFormat;
      existing.matchType = rg.matchType || existing.matchType;
      if ((!existing.events || existing.events.length === 0) && rg.events?.length > 0) {
        existing.events = rg.events;
        existing.duration = rg.duration;
      }
    } else {
      kept.push(rg);
    }
  }
  kept.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return kept;
}
