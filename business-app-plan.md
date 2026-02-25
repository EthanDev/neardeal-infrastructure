# NearDeal Business App — Implementation Plan

## Overview

A mobile-first Progressive Web App (PWA) for businesses to create deals, scan QR codes, view analytics, and manage subscriptions. Built with Next.js 14 App Router, deployed via Amplify Hosting at `business.neardeal.ro`.

**Primary language:** Romanian | **Secondary language:** English
**Design:** Dark theme matching brand identity (bg `#0c0c0f`, accent `#c8e000`, typography Syne headings + DM Sans body)

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 14 (App Router) | SSR, file-based routing, API routes |
| Language | TypeScript | Type safety across codebase |
| Styling | Tailwind CSS + custom theme | Utility-first, matches design tokens |
| State | Zustand | Lightweight, no boilerplate |
| Forms | react-hook-form + zod | Validation, performance |
| i18n | next-intl@3 | App Router native, message catalogs |
| Charts | Recharts | Composable, responsive |
| QR Scanner | html5-qrcode | No native dependencies |
| PWA | @ducanh2912/next-pwa | Service worker, offline support |
| Auth | amazon-cognito-identity-js | Direct Cognito integration (no Amplify) |
| HTTP | Custom fetch wrapper | JWT auto-attach, token refresh |

---

## Project Structure

```
neardeal-business/
├── public/
│   ├── manifest.json
│   ├── icons/                    # PWA icons (192, 512)
│   ├── splash.svg
│   └── locales/
│       ├── ro.json
│       └── en.json
├── src/
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── layout.tsx        # Root layout (providers, nav)
│   │   │   ├── page.tsx          # Redirect to /dashboard
│   │   │   ├── (auth)/
│   │   │   │   ├── splash/page.tsx
│   │   │   │   ├── login/page.tsx
│   │   │   │   ├── signup/page.tsx
│   │   │   │   ├── reset-password/page.tsx
│   │   │   │   └── layout.tsx    # Auth layout (no nav)
│   │   │   ├── (app)/
│   │   │   │   ├── dashboard/page.tsx
│   │   │   │   ├── deals/
│   │   │   │   │   ├── page.tsx          # My Deals list
│   │   │   │   │   ├── create/page.tsx   # Create Deal wizard
│   │   │   │   │   └── [id]/page.tsx     # Deal detail
│   │   │   │   ├── scanner/page.tsx      # QR redemption
│   │   │   │   ├── analytics/page.tsx
│   │   │   │   ├── profile/page.tsx
│   │   │   │   ├── subscription/page.tsx
│   │   │   │   └── layout.tsx    # App layout (bottom nav)
│   │   │   └── not-found.tsx
│   │   └── api/                  # Optional BFF endpoints
│   ├── components/
│   │   ├── ui/                   # Button, Input, Card, Modal, Toast
│   │   ├── auth/                 # LoginForm, SignupForm, SocialButtons
│   │   ├── deals/                # DealCard, DealWizard, DealList
│   │   ├── scanner/              # QrScanner, RedemptionResult
│   │   ├── analytics/            # KpiCard, ChartCard, DateFilter
│   │   ├── nav/                  # BottomNav, TopBar, LanguageToggle
│   │   └── layout/               # SplashScreen, PageTransition
│   ├── lib/
│   │   ├── auth.ts               # Cognito auth helpers
│   │   ├── api.ts                # Fetch wrapper with JWT
│   │   ├── store.ts              # Zustand stores
│   │   └── utils.ts              # Formatters, validators
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useDeals.ts
│   │   └── useAnalytics.ts
│   ├── i18n/
│   │   ├── config.ts
│   │   ├── ro.json
│   │   └── en.json
│   └── styles/
│       └── globals.css           # Tailwind base + custom tokens
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Design Tokens

```typescript
const theme = {
  colors: {
    bg: '#0c0c0f',
    surface: '#1a1a1f',
    surfaceHover: '#242429',
    border: '#2a2a30',
    accent: '#c8e000',
    accentMuted: '#a0b300',
    text: '#ffffff',
    textSecondary: '#8a8a8f',
    textTertiary: '#5a5a5f',
    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
  },
  fonts: {
    heading: 'Syne, sans-serif',
    body: 'DM Sans, sans-serif',
  },
  radius: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    full: '9999px',
  },
};
```

---

## Screens & Features

### 1. Splash Screen
- App logo centered on `#0c0c0f` background
- 2-second display, then auto-redirect:
  - Has valid session -> `/dashboard`
  - No session -> `/login`
- Language auto-detected from browser, stored in localStorage

### 2. Authentication

#### 2.1 Signup
- **Step 1:** Business name, owner name, email, password (strength indicator), confirm password
- **Step 2:** Business category (dropdown), address, city, district
- **Social sign-in buttons:** Apple, Google, Facebook (via Cognito Hosted UI redirect)
- Password requirements displayed inline: 8+ chars, 1 uppercase, 1 number
- "Already have an account?" link to login
- On success: Cognito post-confirmation trigger creates business profile in DynamoDB

#### 2.2 Login
- Email + password fields
- "Forgot password?" link
- Social sign-in buttons (same 3 providers)
- "Don't have an account?" link to signup
- Remember me checkbox (extends refresh token usage)

#### 2.3 Reset Password
- **Step 1:** Enter email -> sends Cognito verification code
- **Step 2:** Enter code + new password + confirm password
- Success -> redirect to login with toast

#### 2.4 Language Toggle
- Globe icon in top-right of auth screens
- Dropdown: "Romana" / "English"
- Persisted to localStorage, applied via next-intl locale routing

### 3. Dashboard (Home)
- **Top bar:** Business name, notification bell, language toggle
- **KPI row (4 cards):**
  - Active Deals count
  - Total Claims (today)
  - Revenue saved for customers
  - Redemption rate %
- **Quick actions:** Create Deal (primary CTA), Scan QR
- **Recent activity feed:** Last 5 claim/redemption events with timestamps
- **Pull-to-refresh** for mobile feel

### 4. Create Deal (5-Step Wizard)
- **Step 1 — Basics:** Title, description, category (dropdown)
- **Step 2 — Pricing:** Original price, discounted price (auto-calculates % off), max claims
- **Step 3 — Location:** Map pin (Leaflet/Mapbox), auto-filled from business profile, editable
- **Step 4 — Timing:** Expiry date/time picker, flash deal toggle (if toggled: flash expiry picker)
- **Step 5 — Review:** Summary card, image upload (optional), confirm button
- Progress bar at top showing steps 1-5
- Back/Next navigation, draft auto-saved to localStorage

### 5. My Deals
- **Tabs:** Active | Expired | Draft
- **Deal cards:** Title, category badge, claims progress bar (`claimCount/maxClaims`), time remaining, status badge
- **Actions per deal:** View detail, pause/resume, duplicate, delete
- **Sort:** Newest, ending soon, most claimed
- **Empty state:** Illustration + "Create your first deal" CTA

### 6. Deal Detail
- Full deal info with live claim counter
- QR code display (for in-store posting)
- Claim history table (who claimed, when, redeemed?)
- Edit button (limited fields editable after creation)

### 7. QR Scanner
- Full-screen camera view using html5-qrcode
- Scans `claimId:hmacSignature` from consumer's QR
- Calls `POST /api/claims/redeem` with scanned payload
- **Success state:** Green checkmark, deal title, discount amount, animation
- **Error states:** Already redeemed, expired, invalid QR — each with clear message
- Manual code entry fallback (text input)

### 8. Analytics
- **Date range filter:** Today, 7 days, 30 days, custom
- **Charts:**
  - Claims over time (line chart)
  - Top deals by claims (horizontal bar)
  - Redemption rate trend (area chart)
  - Revenue impact (claims x discount value)
- **Export:** CSV download button

### 9. Profile & Settings
- Business info (editable): name, address, logo upload, category
- Account: email (read-only), change password
- Notification preferences: push toggle, email digest toggle
- Language setting
- Delete account (with confirmation modal)
- Logout

### 10. Subscription
- Current plan display with usage meter (deals created / plan limit)
- Plan comparison cards: Free, Pro, Premium
- Upgrade CTA -> Stripe Checkout redirect
- Billing history table
- Cancel subscription (with retention modal)

---

## Bottom Navigation (5 tabs)

| Icon | Label (RO) | Label (EN) | Route |
|---|---|---|---|
| Home | Acasa | Home | /dashboard |
| Deals | Oferte | Deals | /deals |
| + (FAB) | Creeaza | Create | /deals/create |
| Scanner | Scaneaza | Scan | /scanner |
| Profil | Profil | Profile | /profile |

Center tab is elevated (floating action button style) with accent color.

---

## Authentication Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Splash      │────>│  Cognito User    │────>│  API Gateway │
│  Screen      │     │  Pool (Business) │     │  (JWT Auth)  │
└─────────────┘     └──────────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │             │
              Email/Pass    Social (Hosted UI)
                           Apple/Google/Facebook
```

**Token management:**
- Access token (1hr) stored in memory (Zustand)
- Refresh token (30d) stored in secure httpOnly cookie or localStorage
- Auto-refresh on 401 response via fetch wrapper
- Silent refresh on app foreground

**Auth state (Zustand):**
```typescript
interface AuthState {
  user: CognitoUser | null;
  businessId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
}
```

**Protected routes:**
- Middleware in `src/middleware.ts` checks for valid session
- Unauthenticated users redirected to `/login`
- Auth pages redirect to `/dashboard` if already authenticated

---

## Internationalization

**next-intl configuration:**
- Default locale: `ro`
- Supported locales: `['ro', 'en']`
- Locale stored in URL path: `/ro/dashboard`, `/en/dashboard`
- Language toggle switches locale and redirects

**Translation file structure (flat keys):**
```json
{
  "splash.tagline": "Platforma ta de oferte locale",
  "auth.login.title": "Conecteaza-te",
  "auth.login.email": "Adresa de email",
  "auth.login.password": "Parola",
  "auth.login.submit": "Conectare",
  "auth.login.forgot": "Ai uitat parola?",
  "auth.login.noAccount": "Nu ai cont?",
  "auth.login.signup": "Inregistreaza-te",
  "auth.signup.title": "Creeaza cont",
  "dashboard.title": "Panou de control",
  "dashboard.activeDeals": "Oferte active",
  "dashboard.totalClaims": "Revendicari totale",
  "deals.create.title": "Creeaza oferta",
  "scanner.title": "Scaneaza codul QR",
  "scanner.success": "Revendicare validata!",
  "scanner.error.expired": "Aceasta oferta a expirat",
  "scanner.error.redeemed": "Deja revendicat",
  "common.save": "Salveaza",
  "common.cancel": "Anuleaza",
  "common.back": "Inapoi",
  "common.next": "Urmatorul"
}
```

---

## API Integration

All API calls go through `src/lib/api.ts`:

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL; // per-stage

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
  if (res.status === 401) {
    await useAuthStore.getState().refreshSession();
    return apiFetch(path, options); // retry once
  }
  if (!res.ok) throw new ApiError(res.status, await res.json());
  return res.json();
}
```

**Key endpoints used:**
| Method | Path | Screen |
|---|---|---|
| POST | /api/deals | Create Deal |
| GET | /api/deals?businessId={id} | My Deals |
| GET | /api/deals/{id} | Deal Detail |
| POST | /api/claims/redeem | QR Scanner |
| GET | /api/business/dashboard | Dashboard |
| GET | /api/business/analytics | Analytics |
| PUT | /api/business/profile | Profile |
| GET | /api/stats/{city} | Dashboard |

---

## PWA Configuration

```json
{
  "name": "NearDeal Business",
  "short_name": "NearDeal Biz",
  "start_url": "/ro/dashboard",
  "display": "standalone",
  "background_color": "#0c0c0f",
  "theme_color": "#c8e000",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- Service worker caches static assets and API responses (stale-while-revalidate)
- Offline fallback page with "No connection" message
- Add-to-homescreen prompt after 2nd visit

---

## Performance Strategy

- **Code splitting:** Each route is a dynamic import (Next.js automatic)
- **Image optimization:** next/image with WebP, lazy loading
- **Bundle target:** < 200KB initial JS (gzipped)
- **Lighthouse target:** 90+ on all metrics
- **Font loading:** `next/font` with `display: swap` for Syne + DM Sans
- **API caching:** SWR pattern via Zustand + stale timers

---

## Task List

### Phase 1: Project Setup (Days 1-2)
- [ ] Initialize Next.js 14 project with TypeScript
- [ ] Configure Tailwind CSS with custom design tokens
- [ ] Set up next-intl with ro/en locales
- [ ] Configure @ducanh2912/next-pwa
- [ ] Set up Zustand stores (auth, deals, ui)
- [ ] Create reusable UI components (Button, Input, Card, Modal, Toast)
- [ ] Set up `src/lib/api.ts` fetch wrapper
- [ ] Configure environment variables per stage

### Phase 2: Authentication (Days 3-5)
- [ ] Implement Cognito auth helpers (`src/lib/auth.ts`)
- [ ] Build Splash screen with auto-redirect logic
- [ ] Build Login screen (email/password + social buttons)
- [ ] Build Signup screen (2-step form with validation)
- [ ] Build Reset Password screen (2-step: email -> code + new password)
- [ ] Add language toggle component to auth screens
- [ ] Implement auth middleware (protected routes)
- [ ] Implement token refresh logic
- [ ] Test social sign-in flow (Apple, Google, Facebook via Hosted UI)

### Phase 3: Core Screens (Days 6-10)
- [ ] Build Bottom Navigation with 5 tabs
- [ ] Build Dashboard screen (KPI cards, quick actions, activity feed)
- [ ] Build Create Deal wizard (5 steps with progress bar)
- [ ] Build My Deals screen (tabs, deal cards, sort/filter)
- [ ] Build Deal Detail screen (info, QR display, claim history)
- [ ] Implement deal CRUD API integration

### Phase 4: Scanner & Analytics (Days 11-13)
- [ ] Build QR Scanner screen (html5-qrcode integration)
- [ ] Implement redemption API call and result states
- [ ] Add manual code entry fallback
- [ ] Build Analytics screen (date filter, charts with Recharts)
- [ ] Build CSV export functionality

### Phase 5: Profile & Subscription (Days 14-15)
- [ ] Build Profile screen (business info edit, logo upload, password change)
- [ ] Build Subscription screen (plan display, upgrade flow, billing history)
- [ ] Implement Stripe Checkout redirect for upgrades
- [ ] Build account deletion flow
- [ ] Build notification preferences

### Phase 6: Polish & Deploy (Days 16-18)
- [ ] Complete all Romanian translations
- [ ] Complete all English translations
- [ ] Add page transitions and loading states
- [ ] Implement pull-to-refresh on Dashboard
- [ ] Test PWA install flow (Android + iOS)
- [ ] Lighthouse audit and performance optimization
- [ ] Test all flows end-to-end against dev API
- [ ] Deploy to Amplify Hosting (dev -> staging -> prod)

---

## Verification Checklist

- [ ] Signup flow creates business in Cognito + DynamoDB profile
- [ ] Login returns valid JWT, stored correctly, auto-refreshes
- [ ] Social sign-in redirects to Cognito Hosted UI and returns correctly
- [ ] Language toggle switches all visible text between RO and EN
- [ ] Create Deal wizard writes to DynamoDB + Redis geo index
- [ ] QR Scanner successfully redeems a claim (one-time only)
- [ ] Dashboard KPIs match actual data from API
- [ ] Analytics charts render correctly with real data
- [ ] PWA installs on Android and iOS with correct icon/colors
- [ ] Offline fallback page displays when disconnected
- [ ] All API errors display user-friendly messages in correct language
- [ ] Protected routes redirect unauthenticated users to login
- [ ] Password reset flow works end-to-end
- [ ] Subscription upgrade redirects to Stripe and updates plan on success
