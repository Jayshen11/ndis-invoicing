"use client";

import {
  AuthSessionProvider,
  useAuthSession,
} from "@/modules/auth/components/AuthSessionProvider";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { NavItem } from "@/modules/dashboard/nav-types";
import {
  PORTAL_DASHBOARD_NAV_ITEM,
  PORTAL_PRIMARY_MODULES,
  PORTAL_SETTINGS_MODULES,
  filterNavByPermissions,
} from "@/modules/dashboard/portal-nav";

type AdminShellProps = Readonly<{
  children: React.ReactNode;
}>;

/** Raster wordmark cropped from the shared UI template (`public/brand/my-ndis-portal-wordmark.png`). */
const PORTAL_WORDMARK = {
  src: "/brand/my-ndis-portal-wordmark.png",
  width: 292,
  height: 88,
} as const;

const ALL_PRIMARY_NAV_ITEMS: NavItem[] = [
  PORTAL_DASHBOARD_NAV_ITEM,
  ...PORTAL_PRIMARY_MODULES,
];

function isActive(item: NavItem, pathname: string): boolean {
  if (item.matcher) {
    return item.matcher(pathname);
  }

  return item.href ? pathname === item.href : false;
}

function BurgerIcon({
  className = "h-5 w-5",
}: Readonly<{
  className?: string;
}>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function LogOutIcon({ className = "h-4 w-4" }: Readonly<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="12" r="6" />
      <path d="M15 12h6" />
      <path d="M20 9l3 3-3 3" />
    </svg>
  );
}

function LogOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogOut() {
    if (busy) {
      return;
    }

    setBusy(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
    } catch {
      // SEC: Still send user to login; server may still clear cookie on next full navigation.
    }

    router.push("/login");
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="group relative inline-flex">
      <button
        type="button"
        disabled={busy}
        aria-label="Log Out"
        onClick={() => void handleLogOut()}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition hover:bg-slate-200 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LogOutIcon />
      </button>
      <div
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-[60] mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span
          aria-hidden
          className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900"
        />
        <span className="relative">Log Out</span>
      </div>
    </div>
  );
}

function ChevronIcon({
  className = "h-4 w-4",
}: Readonly<{
  className?: string;
}>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: Readonly<{
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}>) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [collapsedTipPos, setCollapsedTipPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const displayCode = item.code || item.label.slice(0, 1).toUpperCase();
  const showCode = Boolean(item.code) || collapsed;
  const layoutClassName = collapsed
    ? "h-10 justify-center px-0"
    : "gap-3 px-3 py-2.5";
  const toneClassName = active
    ? "bg-blue-50 text-sm font-medium text-blue-600"
    : "text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900";
  const className = `flex w-full items-center rounded-xl ${layoutClassName} ${toneClassName}`;
  const labelClassName = collapsed ? "inline md:hidden" : "inline";

  const updateCollapsedTipPosition = useCallback(() => {
    const el = rowRef.current;

    if (!el) {
      return;
    }

    const r = el.getBoundingClientRect();

    setCollapsedTipPos({
      top: r.top + r.height / 2,
      left: r.right + 8,
    });
  }, []);

  const openCollapsedTip = useCallback(() => {
    if (!collapsed) {
      return;
    }

    updateCollapsedTipPosition();
  }, [collapsed, updateCollapsedTipPosition]);

  const closeCollapsedTip = useCallback(() => {
    setCollapsedTipPos(null);
  }, []);

  useLayoutEffect(() => {
    if (!collapsed || collapsedTipPos === null) {
      return;
    }

    const navEl = rowRef.current?.closest("nav");

    function update() {
      updateCollapsedTipPosition();
    }

    window.addEventListener("resize", update);
    navEl?.addEventListener("scroll", update, { passive: true });

    return () => {
      window.removeEventListener("resize", update);
      navEl?.removeEventListener("scroll", update);
    };
  }, [collapsed, collapsedTipPos, updateCollapsedTipPosition]);

  const content = collapsed ? (
    <span className="text-center text-xs font-semibold leading-none tracking-tight">
      {displayCode}
    </span>
  ) : (
    <>
      {showCode ? (
        <span className="w-5 shrink-0 text-center text-xs font-semibold">
          {displayCode}
        </span>
      ) : null}
      <span className={labelClassName}>{item.label}</span>
    </>
  );

  const collapsedTooltipPortal =
    collapsed &&
    collapsedTipPos !== null &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[70] whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-lg"
            style={{
              top: collapsedTipPos.top,
              left: collapsedTipPos.left,
              transform: "translateY(-50%)",
            }}
          >
            {item.label}
          </div>,
          document.body,
        )
      : null;

  const rowHandlers = collapsed
    ? {
        onMouseEnter: openCollapsedTip,
        onMouseLeave: closeCollapsedTip,
        onFocusCapture: openCollapsedTip,
        onBlurCapture: closeCollapsedTip,
      }
    : {};

  if (!item.href) {
    return (
      <div
        ref={rowRef}
        className="relative w-full"
        {...rowHandlers}
      >
        <span className={className} aria-label={collapsed ? item.label : undefined}>
          {content}
        </span>
        {collapsedTooltipPortal}
      </div>
    );
  }

  return (
    <div ref={rowRef} className="relative w-full" {...rowHandlers}>
      <Link
        href={item.href}
        className={className}
        aria-label={collapsed ? item.label : undefined}
        onClick={onNavigate}
      >
        {content}
      </Link>
      {collapsedTooltipPortal}
    </div>
  );
}

function isSettingsAreaPathname(pathname: string): boolean {
  return (
    pathname.startsWith("/settings") || pathname.startsWith("/rbac-roles")
  );
}

function SettingsSection({
  pathname,
  collapsed,
  isOpen,
  items,
  onToggle,
  onNavigate,
}: Readonly<{
  pathname: string;
  collapsed: boolean;
  isOpen: boolean;
  items: NavItem[];
  onToggle: () => void;
  onNavigate: () => void;
}>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverFlyoutOpen, setHoverFlyoutOpen] = useState(false);
  const [flyoutStyle, setFlyoutStyle] = useState<React.CSSProperties | null>(
    null,
  );
  const isSettingsRoute = isSettingsAreaPathname(pathname);
  const showSettingsItems = !collapsed && (isOpen || isSettingsRoute);
  const showCollapsedFlyout = collapsed;
  /** Collapsed rail: submenu only while pointer/focus is on S or the flyout (no click-to-pin). */
  const collapsedFlyoutVisible = collapsed && hoverFlyoutOpen;

  const clearHoverCloseTimer = useCallback(() => {
    if (hoverCloseTimerRef.current !== null) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const scheduleHoverFlyoutClose = useCallback(() => {
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = setTimeout(() => {
      hoverCloseTimerRef.current = null;
      setHoverFlyoutOpen(false);
    }, 220);
  }, [clearHoverCloseTimer]);

  useEffect(() => {
    return () => {
      clearHoverCloseTimer();
    };
  }, [clearHoverCloseTimer]);

  useEffect(() => {
    setHoverFlyoutOpen(false);
  }, [pathname]);

  const headerToneClassName =
    collapsed && collapsedFlyoutVisible
      ? "bg-slate-100 text-blue-600 hover:bg-slate-100"
      : isSettingsRoute || isOpen
        ? "text-blue-600 hover:bg-blue-50"
        : "text-slate-500 hover:bg-slate-100";
  const buttonLayoutClassName = collapsed
    ? "h-10 justify-center px-0"
    : "justify-between px-3 py-2.5 text-left";

  useEffect(() => {
    if (!collapsedFlyoutVisible) {
      return;
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const t = event.target as Node;

      if (rootRef.current?.contains(t) || flyoutRef.current?.contains(t)) {
        return;
      }

      setHoverFlyoutOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setHoverFlyoutOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [collapsedFlyoutVisible]);

  useLayoutEffect(() => {
    if (!collapsedFlyoutVisible || !buttonRef.current) {
      setFlyoutStyle(null);
      return;
    }

    const buttonEl = buttonRef.current;
    const navEl = buttonEl.closest("nav");

    function updatePosition() {
      const r = buttonEl.getBoundingClientRect();

      setFlyoutStyle({
        position: "fixed",
        top: r.top + r.height / 2,
        left: r.right + 8,
        transform: "translateY(-50%)",
        zIndex: 60,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    navEl?.addEventListener("scroll", updatePosition, { passive: true });

    return () => {
      window.removeEventListener("resize", updatePosition);
      navEl?.removeEventListener("scroll", updatePosition);
    };
  }, [collapsedFlyoutVisible]);

  function handleFlyoutItemNavigate() {
    clearHoverCloseTimer();
    setHoverFlyoutOpen(false);
    onNavigate();
  }

  function renderFlyoutItem(item: NavItem) {
    const active = isActive(item, pathname);
    const className = active
      ? "block rounded-xl bg-blue-50 px-3 py-2 text-sm font-medium text-blue-600"
      : "block rounded-xl px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900";

    if (!item.href) {
      return (
        <span key={item.label} className={className}>
          {item.label}
        </span>
      );
    }

    return (
      <Link
        key={item.label}
        href={item.href}
        className={className}
        onClick={handleFlyoutItemNavigate}
      >
        {item.label}
      </Link>
    );
  }

  const flyoutPanel =
    showCollapsedFlyout &&
    collapsedFlyoutVisible &&
    flyoutStyle &&
    typeof document !== "undefined" ? (
      createPortal(
        <div
          ref={flyoutRef}
          id="settings-collapsed-flyout"
          role="menu"
          aria-hidden={false}
          style={flyoutStyle}
          onMouseEnter={() => {
            clearHoverCloseTimer();
            setHoverFlyoutOpen(true);
          }}
          onMouseLeave={() => {
            scheduleHoverFlyoutClose();
          }}
          className="min-w-56 max-w-[min(18rem,calc(100vw-4rem))] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
        >
          <div className="space-y-1" role="none">
            {items.map(renderFlyoutItem)}
          </div>
        </div>,
        document.body,
      )
    ) : null;

  return (
    <div ref={rootRef} className="relative mt-6 w-full">
      <div className="relative w-full">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            if (!collapsed) {
              onToggle();
            }
          }}
          onMouseEnter={() => {
            if (!collapsed) {
              return;
            }

            clearHoverCloseTimer();
            setHoverFlyoutOpen(true);
          }}
          onMouseLeave={() => {
            if (!collapsed) {
              return;
            }

            scheduleHoverFlyoutClose();
          }}
          onFocus={() => {
            if (!collapsed) {
              return;
            }

            clearHoverCloseTimer();
            setHoverFlyoutOpen(true);
          }}
          onBlur={(event) => {
            if (!collapsed) {
              return;
            }

            const next = event.relatedTarget as Node | null;

            if (next && flyoutRef.current?.contains(next)) {
              return;
            }

            scheduleHoverFlyoutClose();
          }}
          aria-expanded={
            collapsed ? collapsedFlyoutVisible : showSettingsItems
          }
          aria-haspopup={collapsed ? "menu" : undefined}
          aria-controls={
            collapsed ? "settings-collapsed-flyout" : undefined
          }
          aria-label="Settings"
          className={`flex w-full items-center rounded-xl transition ${buttonLayoutClassName} ${headerToneClassName}`}
        >
          {collapsed ? (
            <span className="text-center text-xs font-semibold leading-none">
              S
            </span>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="w-5 shrink-0 text-xs font-semibold">S</span>
                <span className="text-sm font-medium">Settings</span>
              </div>
              <ChevronIcon
                className={`h-4 w-4 shrink-0 transition-transform ${
                  showSettingsItems ? "rotate-180" : ""
                }`}
              />
            </>
          )}
        </button>
      </div>

      {flyoutPanel}

      <div className={showSettingsItems ? "mt-2 space-y-1" : "hidden"}>
        {items.map((item) => (
          <NavLink
            key={item.label}
            item={item}
            active={isActive(item, pathname)}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

function AdminShellAuthenticated({ children }: AdminShellProps) {
  const pathname = usePathname();
  const { session, isLoading } = useAuthSession();

  const nameOrEmail =
    session?.user.fullName?.trim() || session?.user.email?.trim() || "";
  let portalUserLabel = "";
  if (nameOrEmail !== "") {
    portalUserLabel = nameOrEmail;
  } else if (isLoading) {
    portalUserLabel = "Loading…";
  }

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(
    isSettingsAreaPathname(pathname),
  );

  useEffect(() => {
    if (isSettingsAreaPathname(pathname)) {
      setIsSettingsOpen(true);
    }
  }, [pathname]);

  const sidebarWidthClass = isSidebarCollapsed ? "md:w-14" : "md:w-60";
  const contentOffsetClass = isSidebarCollapsed ? "md:pl-14" : "md:pl-60";
  const headerPaddingClassName = isSidebarCollapsed ? "px-1.5 py-3" : "px-5 py-4";
  const navPaddingClassName = isSidebarCollapsed ? "px-1.5 py-5" : "px-3 py-5";
  const isDashboardRoute = pathname === "/" || pathname === "/dashboard";

  function toggleSidebar() {
    setIsSidebarCollapsed((current) => !current);
  }

  function toggleSettingsSection() {
    if (isSidebarCollapsed) {
      return;
    }

    setIsSettingsOpen((current) => !current);
  }

  const wordmarkAlt =
    portalUserLabel === ""
      ? "My NDIS Portal"
      : `My NDIS Portal — ${portalUserLabel}`;

  const authReady = !isLoading && session !== null;
  const permissionSet = useMemo(
    () => (session ? new Set(session.user.permissions) : null),
    [session],
  );

  const visiblePrimaryNav = useMemo(
    () =>
      filterNavByPermissions(ALL_PRIMARY_NAV_ITEMS, permissionSet, authReady),
    [permissionSet, authReady],
  );

  const visibleSettingsNav = useMemo(
    () =>
      filterNavByPermissions(
        PORTAL_SETTINGS_MODULES,
        permissionSet,
        authReady,
      ),
    [permissionSet, authReady],
  );

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      {isSidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-900/30 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 shrink-0 border-r border-slate-200 bg-white transition-[width,transform] duration-200 md:translate-x-0 ${sidebarWidthClass} ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-full flex-col">
          <div className={`border-b border-slate-200 ${headerPaddingClassName}`}>
            {isSidebarCollapsed ? (
              <div className="hidden w-full flex-col items-center justify-center gap-2 text-slate-500 md:flex">
                <LogOutButton />
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-slate-100"
                  aria-label={
                    isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                  }
                  aria-pressed={isSidebarCollapsed}
                  onClick={toggleSidebar}
                >
                  <BurgerIcon className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                    My NDIS Portal
                  </h1>
                  <p className="mt-1 truncate text-sm text-slate-400">
                    {portalUserLabel === "" ? "\u00a0" : portalUserLabel}
                  </p>
                </div>

                <div className="flex items-center gap-2 text-slate-500">
                  <LogOutButton />
                  <button
                    type="button"
                    className="hidden h-8 w-8 items-center justify-center rounded-full transition hover:bg-slate-100 md:inline-flex"
                    aria-label="Collapse sidebar"
                    aria-pressed={false}
                    onClick={toggleSidebar}
                  >
                    <BurgerIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            <div className="mt-0 flex items-center gap-2 text-slate-500 md:hidden">
              <div className="flex-1" />
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-slate-100"
                aria-label="Close navigation"
                onClick={() => setIsSidebarOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <nav
            className={`flex-1 overflow-y-auto ${navPaddingClassName}`}
          >
            <div
              className={
                isSidebarCollapsed
                  ? "flex w-full flex-col items-stretch space-y-1"
                  : "space-y-1"
              }
            >
              {visiblePrimaryNav.map((item) => (
                <NavLink
                  key={item.href ?? item.label}
                  item={item}
                  active={isActive(item, pathname)}
                  collapsed={isSidebarCollapsed}
                  onNavigate={() => setIsSidebarOpen(false)}
                />
              ))}
            </div>

            {visibleSettingsNav.length > 0 ? (
              <SettingsSection
                pathname={pathname}
                collapsed={isSidebarCollapsed}
                isOpen={isSettingsOpen}
                items={visibleSettingsNav}
                onToggle={toggleSettingsSection}
                onNavigate={() => setIsSidebarOpen(false)}
              />
            ) : null}
          </nav>
        </div>
      </aside>

      <div className={`transition-[padding] duration-200 ${contentOffsetClass}`}>
        <div className="border-b border-slate-200 bg-white px-4 py-3 shadow-sm md:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
              aria-label="Open navigation"
              onClick={() => setIsSidebarOpen(true)}
            >
              <BurgerIcon />
            </button>

            <div className="min-w-0">
              <Link
                href="/dashboard"
                className="inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-md"
              >
                <Image
                  {...PORTAL_WORDMARK}
                  alt={wordmarkAlt}
                  className="h-auto max-h-10 w-auto max-w-[200px]"
                  sizes="200px"
                />
              </Link>
              <p className="mt-1 text-base font-semibold text-slate-900">
                {isDashboardRoute ? "Dashboard" : "Admin"}
              </p>
            </div>
          </div>
        </div>

        <main>
          <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname();
  const isLoginRoute = pathname === "/login";
  const isUnauthorizedRoute = pathname === "/unauthorized";
  const isFullScreenChromeRoute = isLoginRoute || isUnauthorizedRoute;

  if (isFullScreenChromeRoute) {
    return (
      <div className="min-h-dvh min-h-screen w-full bg-[#f5f7fb] text-slate-900">
        {children}
      </div>
    );
  }

  return (
    <AuthSessionProvider>
      <AdminShellAuthenticated>{children}</AdminShellAuthenticated>
    </AuthSessionProvider>
  );
}
