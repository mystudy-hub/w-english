import { useEffect, useState } from 'react';
import { useAppStore } from './store.ts';

const currentRoute = () => {
  try { return decodeURIComponent(location.hash.slice(1)) || '/'; } catch { return '/'; }
};
export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const changed = () => {
      const next = currentRoute();
      if (next !== '/parent') useAppStore.setState({ parentAuthorized: false });
      setRoute(next);
    };
    addEventListener('hashchange', changed);
    return () => removeEventListener('hashchange', changed);
  }, []);
  return route;
}
export function navigate(route: string) {
  if (route !== '/parent') useAppStore.setState({ parentAuthorized: false });
  location.hash = route;
}
