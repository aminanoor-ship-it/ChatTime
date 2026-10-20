import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Debounced people search; returns no results until the query has 2+ characters.
export default function useUserSearch(query, { enabled = true } = {}) {
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api.get('/users', { params: { q } })
        .then(({ data }) => { if (!cancelled) setResults(data.users); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enabled]);

  return { results, searching };
}
