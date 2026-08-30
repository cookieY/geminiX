import { Suspense, type LazyExoticComponent, type ComponentType } from "react";

/** Lazy-route suspense shell; the visual skeleton arrives with FE-F2. */
export function Loadable(component: LazyExoticComponent<ComponentType>) {
  const Component = component;
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center" aria-busy="true">
          <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}
