# NearDeal Business App — Implementation Plan

## Overview

A native iOS app for businesses to create deals, scan QR codes, view analytics, and manage subscriptions. Built with Expo (React Native), TypeScript, and NativeWind (Tailwind for RN). Distributed via TestFlight and the App Store.

**Primary language:** Romanian | **Secondary language:** English
**Design:** Dark theme matching brand identity (bg `#0c0c0f`, accent `#c8e000`, typography Syne headings + DM Sans body)

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Expo SDK 52 (managed workflow) | OTA updates, EAS Build, native modules |
| Language | TypeScript | Type safety across codebase |
| Navigation | expo-router (file-based) | Native stack/tab navigation, deep linking |
| Styling | NativeWind v4 (Tailwind) | Utility-first, familiar Tailwind API |
| State | Zustand | Lightweight, no boilerplate |
| Forms | react-hook-form + zod | Validation, performance |
| i18n | i18next + react-i18next + expo-localization | Mature RN i18n, device locale detection |
| Charts | react-native-chart-kit | Lightweight, SVG-based |
| QR Scanner | expo-camera (CameraView + barcode) | Native camera, built-in barcode scanning |
| Auth | amazon-cognito-identity-js | Direct Cognito integration (no Amplify) |
| Storage | expo-secure-store | Encrypted token storage on device |
| HTTP | Custom fetch wrapper | JWT auto-attach, token refresh |
| Haptics | expo-haptics | Tactile feedback on scan success/error |
| Push | expo-notifications + SNS | Push via FCM/APNs through existing infra |

---

## Project Structure

```
neardeal-business/
├── app/
│   ├── _layout.tsx               # Root layout (providers, fonts, i18n init)
│   ├── index.tsx                  # Splash screen -> auth check -> redirect
│   ├── (auth)/
│   │   ├── _layout.tsx           # Auth stack (no tabs)
│   │   ├── login.tsx
│   │   ├── signup.tsx
│   │   └── reset-password.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx           # Tab navigator (5 tabs)
│   │   ├── dashboard.tsx
│   │   ├── deals/
│   │   │   ├── _layout.tsx       # Deals stack
│   │   │   ├── index.tsx         # My Deals list
│   │   │   ├── create.tsx        # Create Deal wizard
│   │   │   └── [id].tsx          # Deal detail
│   │   ├── create.tsx            # Center tab -> deals/create redirect
│   │   ├── scanner.tsx           # QR redemption
│   │   └── profile/
│   │       ├── _layout.tsx
│   │       ├── index.tsx         # Profile & settings
│   │       ├── subscription.tsx
│   │       └── analytics.tsx
├── components/
│   ├── ui/                       # Button, Input, Card, Modal, Toast
│   ├── auth/                     # LoginForm, SignupForm, SocialButtons
│   ├── deals/                    # DealCard, DealWizard, StepIndicator
│   ├── scanner/                  # ScannerOverlay, RedemptionResult
│   ├── analytics/                # KpiCard, ChartCard, DateFilter
│   └── nav/                      # TabBar, Header, LanguageToggle
├── lib/
│   ├── auth.ts                   # Cognito auth helpers
│   ├── api.ts                    # Fetch wrapper with JWT
│   ├── store.ts                  # Zustand stores (auth, deals, ui)
│   └── utils.ts                  # Formatters, validators
├── hooks/
│   ├── useAuth.ts
│   ├── useDeals.ts
│   └── useAnalytics.ts
├── i18n/
│   ├── index.ts                  # i18next init
│   ├── ro.json
│   └── en.json
├── assets/
│   ├── fonts/
│   │   ├── Syne-Bold.ttf
│   │   ├── Syne-SemiBold.ttf
│   │   ├── DMSans-Regular.ttf
│   │   ├── DMSans-Medium.ttf
│   │   └── DMSans-Bold.ttf
│   ├── images/
│   │   ├── splash.png
│   │   ├── icon.png
│   │   └── adaptive-icon.png
│   └── icons/                    # Flat SVG icons (react-native-svg)
├── app.json                      # Expo config
├── eas.json                      # EAS Build profiles (dev, preview, prod)
├── tailwind.config.ts
├── nativewind-env.d.ts
├── tsconfig.json
└── package.json
```

---

## Design Tokens (tailwind.config.ts)

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.tsx', './components/**/*.tsx'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#0c0c0f',
        surface: '#1a1a1f',
        'surface-hover': '#242429',
        border: '#2a2a30',
        accent: '#c8e000',
        'accent-muted': '#a0b300',
        'text-primary': '#ffffff',
        'text-secondary': '#8a8a8f',
        'text-tertiary': '#5a5a5f',
        success: '#22c55e',
        error: '#ef4444',
        warning: '#f59e0b',
      },
      fontFamily: {
        'heading': ['Syne-Bold'],
        'heading-semi': ['Syne-SemiBold'],
        'body': ['DMSans-Regular'],
        'body-medium': ['DMSans-Medium'],
        'body-bold': ['DMSans-Bold'],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

---

## Screens & Features

### 1. Splash Screen (`app/index.tsx`)
- App logo centered on `bg` background with subtle fade-in animation
- Checks `expo-secure-store` for refresh token
- Valid session -> navigate to `/(tabs)/dashboard`
- No session -> navigate to `/(auth)/login`
- Device locale detected via `expo-localization`, sets i18n language

### 2. Authentication

#### 2.1 Signup (`app/(auth)/signup.tsx`)
- **Step 1:** Business name, owner name, email, password (strength indicator), confirm password
- **Step 2:** Business category (picker), address, city, district
- **Social sign-in:** Apple (native via `expo-apple-authentication`), Google (`expo-auth-session`), Facebook (`expo-auth-session`)
  - Social providers exchange tokens with Cognito federated identity
- Password requirements displayed inline: 8+ chars, 1 uppercase, 1 number
- "Already have an account?" pressable to login
- On success: Cognito post-confirmation trigger creates business profile in DynamoDB
- Keyboard-aware scroll view for form fields

#### 2.2 Login (`app/(auth)/login.tsx`)
- Email + password fields
- "Forgot password?" pressable
- Social sign-in buttons (same 3 providers)
- "Don't have an account?" pressable to signup
- Biometric login option (Face ID/Touch ID via `expo-local-authentication`) if returning user

#### 2.3 Reset Password (`app/(auth)/reset-password.tsx`)
- **Step 1:** Enter email -> sends Cognito verification code
- **Step 2:** Enter code + new password + confirm password
- Success -> navigate to login with toast

#### 2.4 Language Toggle
- Globe icon in header of auth screens
- Bottom sheet picker: "Romana" / "English"
- Persisted to `expo-secure-store`, applied via i18next `changeLanguage()`

### 3. Dashboard (`app/(tabs)/dashboard.tsx`)
- **Header:** Business name, notification bell, language toggle
- **KPI row (2x2 grid):**
  - Active Deals count
  - Total Claims (today)
  - Revenue saved for customers
  - Redemption rate %
- **Quick actions:** Create Deal (primary CTA), Scan QR (secondary)
- **Recent activity feed:** FlatList of last 10 claim/redemption events with timestamps
- **Pull-to-refresh** via RefreshControl

### 4. Create Deal (`app/(tabs)/deals/create.tsx`)
- **Step 1 — Basics:** Title, description, category (picker)
- **Step 2 — Pricing:** Original price, discounted price (auto-calculates % off), max claims
- **Step 3 — Location:** Map view (`react-native-maps`), pin auto-placed from business profile, draggable
- **Step 4 — Timing:** Date/time picker (`@react-native-community/datetimepicker`), flash deal toggle (if toggled: flash expiry picker)
- **Step 5 — Review:** Summary card, image upload via `expo-image-picker`, confirm button
- Step indicator bar at top (1-5)
- Swipe or button navigation between steps
- Draft auto-saved to AsyncStorage

### 5. My Deals (`app/(tabs)/deals/index.tsx`)
- **Segmented control:** Active | Expired | Draft
- **Deal cards:** Title, category badge, claims progress bar (`claimCount/maxClaims`), countdown timer, status badge
- **Swipe actions:** Pause/resume (left), delete (right)
- **Sort:** Bottom sheet with options: newest, ending soon, most claimed
- **Empty state:** Illustration + "Create your first deal" CTA
- FlatList with pull-to-refresh

### 6. Deal Detail (`app/(tabs)/deals/[id].tsx`)
- Full deal info in scrollable view
- Live claim counter (polls or WebSocket)
- QR code display (generated via `react-native-qrcode-svg`) for in-store posting
- Share button (expo-sharing) to export QR as image
- Claim history list (who claimed, when, redeemed?)
- Edit button (limited fields editable after creation)

### 7. QR Scanner (`app/(tabs)/scanner.tsx`)
- Full-screen native camera via `expo-camera` CameraView with barcode scanning
- Scan overlay with viewfinder frame
- Scans `claimId:hmacSignature` from consumer's QR
- Calls `POST /api/claims/redeem` with scanned payload
- **Success state:** Green checkmark animation (react-native-reanimated), deal title, discount amount, haptic success feedback
- **Error states:** Already redeemed, expired, invalid QR — each with clear message + haptic error
- Manual code entry fallback (text input at bottom)
- Torch toggle button

### 8. Analytics (`app/(tabs)/profile/analytics.tsx`)
- **Date range filter:** Segmented control: Today, 7d, 30d, Custom (date picker)
- **Charts:**
  - Claims over time (line chart)
  - Top deals by claims (horizontal bar)
  - Redemption rate trend (area chart)
  - Revenue impact (claims x discount value)
- **Share:** Export as image via `expo-sharing`

### 9. Profile & Settings (`app/(tabs)/profile/index.tsx`)
- Business info (editable): name, address, logo upload (`expo-image-picker`), category
- Account: email (read-only), change password
- Notification preferences: push toggle, email digest toggle
- Language setting (same bottom sheet picker)
- App version display
- Delete account (with confirmation alert)
- Logout (with confirmation)

### 10. Subscription (`app/(tabs)/profile/subscription.tsx`)
- Current plan display with usage meter (deals created / plan limit)
- Plan comparison cards: Free, Pro, Premium
- Upgrade CTA -> Opens Stripe payment link in `expo-web-browser`
- Billing history list
- Cancel subscription (with retention bottom sheet)

---

## Tab Bar (5 tabs)

| Icon | Label (RO) | Label (EN) | Route |
|---|---|---|---|
| Home | Acasa | Home | /(tabs)/dashboard |
| Deals | Oferte | Deals | /(tabs)/deals |
| + (raised) | Creeaza | Create | /(tabs)/create |
| Scanner | Scaneaza | Scan | /(tabs)/scanner |
| Profil | Profil | Profile | /(tabs)/profile |

Center tab has a raised circular button with accent background color. Custom tab bar component via `tabBar` prop on Tab layout.

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
              Email/Pass    Social (Native)
                         Apple / Google / Facebook
```

**Token management:**
- Access token (1hr) stored in memory (Zustand)
- Refresh token (30d) stored in `expo-secure-store` (encrypted keychain)
- ID token used for API calls (JWT authorizer expects this)
- Auto-refresh on 401 response via fetch wrapper
- Silent refresh on AppState `active` event

**Auth state (Zustand):**
```typescript
interface AuthState {
  user: CognitoUser | null;
  businessId: string | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  socialSignIn: (provider: 'apple' | 'google' | 'facebook') => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
}
```

**Protected routes:**
- Root layout checks auth state on mount
- Unauthenticated users redirected to `/(auth)/login` via `router.replace`
- Auth screens redirect to `/(tabs)/dashboard` if already authenticated

---

## Internationalization

**i18next configuration:**
```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import ro from './ro.json';
import en from './en.json';

i18n.use(initReactI18next).init({
  resources: { ro: { translation: ro }, en: { translation: en } },
  lng: Localization.locale.startsWith('ro') ? 'ro' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});
```

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

All API calls go through `lib/api.ts`:

```typescript
import { useAuthStore } from './store';

const API_BASE = process.env.EXPO_PUBLIC_API_URL;

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

## EAS Build Configuration (eas.json)

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true }
    },
    "preview": {
      "distribution": "internal",
      "ios": { "resourceClass": "m-medium" }
    },
    "production": {
      "ios": { "resourceClass": "m-medium" },
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "...", "ascAppId": "...", "appleTeamId": "..." }
    }
  }
}
```

---

## Performance Strategy

- **Navigation:** Native stack navigators (no JS-based transitions)
- **Lists:** FlatList with `getItemLayout` for fixed-height items, `windowSize` tuning
- **Images:** `expo-image` (backed by SDWebImage) with caching and blurhash placeholders
- **Animations:** `react-native-reanimated` for 60fps UI thread animations
- **Bundle:** Hermes engine (default in Expo SDK 52) for faster startup
- **OTA updates:** `expo-updates` for instant JS bundle patches without App Store review
- **Font loading:** `expo-font` with `SplashScreen.preventAutoHideAsync()` until fonts ready

---

## Task List

### Phase 1: Project Setup (Days 1-2)
- [ ] Create Expo project: `npx create-expo-app neardeal-business --template tabs`
- [ ] Install and configure NativeWind v4 with custom tailwind.config.ts
- [ ] Load custom fonts (Syne, DM Sans) via expo-font
- [ ] Set up i18next with ro/en locales and expo-localization
- [ ] Set up Zustand stores (auth, deals, ui)
- [ ] Create reusable UI components (Button, TextInput, Card, BottomSheet, Toast)
- [ ] Set up `lib/api.ts` fetch wrapper
- [ ] Configure `app.json` (bundle ID, splash, icons, scheme)
- [ ] Configure EAS Build profiles (dev, preview, prod)
- [ ] Set up environment variables via `EXPO_PUBLIC_` prefix

### Phase 2: Authentication (Days 3-5)
- [ ] Implement Cognito auth helpers (`lib/auth.ts`) using amazon-cognito-identity-js
- [ ] Build Splash screen with token check and animated logo
- [ ] Build Login screen (email/password + social buttons)
- [ ] Build Signup screen (2-step form with validation, keyboard-aware)
- [ ] Build Reset Password screen (2-step: email -> code + new password)
- [ ] Implement Apple Sign-In via expo-apple-authentication
- [ ] Implement Google/Facebook Sign-In via expo-auth-session
- [ ] Add language toggle bottom sheet to auth screens
- [ ] Implement auth guard in root layout (redirect logic)
- [ ] Implement token storage in expo-secure-store
- [ ] Implement token refresh on 401 and AppState foreground

### Phase 3: Core Screens (Days 6-10)
- [ ] Build custom tab bar with raised center button
- [ ] Build Dashboard screen (KPI cards grid, quick actions, activity FlatList)
- [ ] Build Create Deal wizard (5 steps with step indicator, swipe navigation)
- [ ] Integrate react-native-maps for location step
- [ ] Integrate @react-native-community/datetimepicker for timing step
- [ ] Integrate expo-image-picker for deal image upload
- [ ] Build My Deals screen (segmented control, deal cards, swipe actions)
- [ ] Build Deal Detail screen (info, QR code via react-native-qrcode-svg, claim list)
- [ ] Implement deal CRUD API integration

### Phase 4: Scanner & Analytics (Days 11-13)
- [ ] Build QR Scanner screen (expo-camera CameraView with barcode scanning)
- [ ] Build scan overlay with viewfinder frame and torch toggle
- [ ] Implement redemption API call with success/error animations (reanimated)
- [ ] Add haptic feedback (expo-haptics) on scan results
- [ ] Add manual code entry fallback
- [ ] Build Analytics screen (segmented date filter, charts with react-native-chart-kit)
- [ ] Implement share/export via expo-sharing

### Phase 5: Profile & Subscription (Days 14-15)
- [ ] Build Profile screen (business info edit, logo upload, password change)
- [ ] Build Subscription screen (plan display, usage meter, plan cards)
- [ ] Implement Stripe payment link via expo-web-browser
- [ ] Build notification preferences (expo-notifications permission + toggles)
- [ ] Build account deletion flow with alert confirmation
- [ ] Build logout with confirmation

### Phase 6: Polish & Submit (Days 16-18)
- [ ] Complete all Romanian translations
- [ ] Complete all English translations
- [ ] Add screen transition animations
- [ ] Add loading skeletons for data-fetching screens
- [ ] Implement pull-to-refresh on Dashboard and My Deals
- [ ] Test all flows end-to-end against dev API
- [ ] EAS Build: create preview build, test on physical device via TestFlight
- [ ] Performance audit: startup time, list scroll FPS, memory usage
- [ ] EAS Build: create production build
- [ ] EAS Submit: submit to App Store Connect

---

## Verification Checklist

- [ ] Signup flow creates business in Cognito + DynamoDB profile
- [ ] Login returns valid JWT, stored in secure store, auto-refreshes
- [ ] Apple/Google/Facebook sign-in works end-to-end
- [ ] Biometric login (Face ID) works for returning users
- [ ] Language toggle switches all visible text between RO and EN
- [ ] Create Deal wizard writes to DynamoDB + Redis geo index
- [ ] QR Scanner successfully redeems a claim (one-time only)
- [ ] Haptic feedback fires on scan success and error
- [ ] Dashboard KPIs match actual data from API
- [ ] Analytics charts render correctly with real data
- [ ] App installs via TestFlight and launches correctly
- [ ] Push notifications received when consumer claims a deal
- [ ] All API errors display user-friendly messages in correct language
- [ ] Protected screens redirect unauthenticated users to login
- [ ] Password reset flow works end-to-end
- [ ] Subscription upgrade opens Stripe and updates plan on success
- [ ] OTA update via expo-updates delivers correctly
