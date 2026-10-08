# 🛡️ Code Rouge

Code Rouge est un bot Discord de **modération, d'administration et de sécurité**, accompagné d'un **dashboard web**. Il protège un ou plusieurs serveurs contre les raids, le spam, les nukes, le phishing et les comptes suspects, et outille la modération quotidienne.

Chaque serveur a sa propre configuration, validée et modifiable depuis Discord ou depuis le dashboard.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Création du bot Discord](#création-du-bot-discord)
- [Variables d'environnement](#variables-denvironnement)
- [Base de données](#base-de-données)
- [Lancement en développement](#lancement-en-développement)
- [Build et production](#build-et-production)
- [Déploiement avec Docker](#déploiement-avec-docker)
- [Configuration d'un serveur](#configuration-dun-serveur)
- [Commandes](#commandes)
- [Sécurité](#sécurité)
- [Tests et qualité](#tests-et-qualité)
- [Dépannage](#dépannage)

---

## Fonctionnalités

| Module | Ce qu'il fait |
| --- | --- |
| **Modération** | `/ban` (définitif ou temporaire), `/unban`, `/kick`, `/timeout`, `/untimeout`, `/warn`, `/warnings`, `/clearwarnings`, `/clear`, `/slowmode`. Confirmation par boutons, respect de la hiérarchie des rôles, numéro de cas, MP au membre. |
| **Avertissements** | Escalade automatique configurable (par défaut : 2 → timeout 10 min, 3 → 1 h, 4 → kick, 5 → ban), expiration optionnelle. |
| **Moteur de risque** | Chaque événement ajoute des points ; le score décroît quand la situation se calme. 4 niveaux : 🟢 Normal, 🟡 Surveillance, 🟠 Sécurité renforcée, 🔴 Lockdown (automatique si activé). |
| **Anti-spam** | Fenêtres glissantes en mémoire (aucune requête SQL par message) : débit, messages identiques ou presque identiques, mentions, emojis, caractères répétés, liens. Tolérance configurable, avertissement puis timeout, timeout long en cas de récidive. |
| **Anti-raid** | Volume d'arrivées (5 / 15 / 30 en 10 s par défaut), comptes récents, pseudos similaires, vagues, activité immédiatement après l'arrivée. |
| **Anti-nuke** | Lit le journal d'audit Discord : suppressions et créations massives de salons et de rôles, bans et kicks massifs, modifications de permissions, webhooks, changements du serveur. Réaction : alerte, retrait des rôles dangereux (réversible) ou ban (uniquement si configuré explicitement). |
| **Anti-alt** | Score de risque par compte (âge, avatar, pseudo généré, arrivée pendant une vague, activité suspecte). Un compte récent n'est **jamais** considéré malveillant à lui seul. |
| **Anti-bot** | Alerte lors de l'ajout d'un bot : qui l'a ajouté, permissions dangereuses, ajouts en rafale. Aucune action contre un bot sans configuration explicite. |
| **Anti-phishing** | Domaines blacklistés, liste intégrée de domaines de phishing, imitations de Discord et Steam (homoglyphes, fautes volontaires), faux Nitro, invitations externes, raccourcisseurs (optionnel). Listes blanche et noire par serveur. Les liens ordinaires ne sont jamais bloqués. |
| **Lockdown** | `/lockdown` et `/unlock` : niveau de vérification, invitations, salons sensibles, quarantaine des nouveaux membres. Tout est **sauvegardé puis restauré**. |
| **Vérification** | Bouton ✅ qui fait passer le membre du rôle « Non vérifié » au rôle « Membre ». Délai minimal, âge minimal du compte, suspension pendant un lockdown. |
| **Tickets** | 6 catégories, salon privé, prise en charge, ajout de membre, fermeture avec raison, **transcript HTML**, suppression. |
| **Annonces** | Embed personnalisable, aperçu avant publication, programmation (Discord et dashboard). |
| **Logs** | Salons séparés pour la modération, les membres, la sécurité, le serveur et les tickets. Chaque entrée indique qui, quoi, quand, sur qui, pourquoi et avec quel résultat. Journal d'audit en base. |
| **Bienvenue** | Message ou embed avec les variables `{user}`, `{username}`, `{server}` et `{memberCount}`. |
| **Statistiques** | `/server`, `/stats`, tableau de bord du dashboard. |
| **Mode simulation** | `/security test raid\|spam\|nuke\|phishing\|alt` : vrais moteurs de détection, aucune action réelle. |
| **Dashboard web** | Connexion OAuth2 Discord. Pages : tableau de bord, sécurité, modération, logs, tickets, annonces, paramètres. Modification de toute la configuration. |

---

## Architecture

```
├── prisma/                     Schéma Prisma et migrations PostgreSQL
├── src/
│   ├── config/                 Variables d'environnement (Zod) et configuration par serveur
│   ├── database/               Client Prisma, bus LISTEN/NOTIFY bot ↔ dashboard
│   ├── permissions/            Niveaux OWNER…MEMBER et hiérarchie (partagés bot + API)
│   ├── services/               Configuration en cache, listes, audit, statistiques bufferisées
│   ├── modules/
│   │   ├── moderation/         Sanctions, escalade des warns, bans temporaires
│   │   ├── security/           Moteur de risque, anti-spam/raid/nuke/alt/bot/phishing, simulation
│   │   ├── lockdown/           Lockdown réversible
│   │   ├── logs/               Salons de logs et format d'audit
│   │   ├── tickets/            Tickets et transcripts
│   │   ├── verification/       Vérification par bouton
│   │   ├── announcements/      Annonces et programmation
│   │   └── welcome/            Messages de bienvenue
│   ├── bot/                    Client discord.js, commandes, événements, interactions
│   ├── dashboard/              API Fastify (OAuth2, sessions, routes)
│   └── __tests__/              Tests unitaires et d'intégration
├── dashboard/frontend/         Dashboard React + Vite
├── docs/COMMANDS.md            Documentation des commandes
├── Dockerfile, docker-compose.yml
└── .env.example
```

**Stack** : Node.js 24, TypeScript, discord.js 14, PostgreSQL 16, Prisma 7, Zod 4, Fastify 5, React 19 et Vite 8, Vitest.

**Principes** :

- **Moteurs de détection purs** (sans dépendance à Discord) : testables et réutilisés tels quels par le mode simulation.
- **Mémoire d'abord** : spam, raid et nuke fonctionnent sur des fenêtres glissantes en mémoire avec expiration. La configuration est mise en cache par serveur et les statistiques sont écrites par lots.
- **Bot et dashboard séparés** : deux processus qui partagent la base. Le dashboard prévient le bot des changements via PostgreSQL `LISTEN/NOTIFY` (invalidation du cache, publication d'annonce immédiate), sans service supplémentaire.

---

## Prérequis

- **Node.js 24** (voir `.nvmrc`) et npm 11
- **PostgreSQL 16**, installé localement ou via Docker
- Une application Discord (voir ci-dessous)

---

## Installation

```bash
git clone <url-du-depot> code-rouge-bot
cd code-rouge-bot
nvm use            # Node 24
npm install        # installe aussi le dashboard et génère le client Prisma
cp .env.example .env
```

---

## Création du bot Discord

1. Ouvrez <https://discord.com/developers/applications>, puis cliquez sur **New Application**.
2. **General Information** : copiez l'**Application ID** dans `CLIENT_ID`.
3. **Bot** :
   - **Reset Token**, puis copiez le token dans `DISCORD_TOKEN` (ne le partagez jamais) ;
   - désactivez **Public Bot** si le bot est réservé à vos serveurs ;
   - activez les **Privileged Gateway Intents** :
     - ✅ **Server Members Intent** (arrivées, anti-raid, vérification, bienvenue)
     - ✅ **Message Content Intent** (anti-spam, anti-phishing)
     - ☐ **Presence Intent** : optionnel, uniquement pour afficher les membres en ligne (puis `ENABLE_PRESENCE_INTENT=true`).
4. **OAuth2** (pour le dashboard) :
   - copiez le **Client Secret** dans `CLIENT_SECRET` ;
   - ajoutez la redirection `<DASHBOARD_URL>/auth/callback`, par exemple `http://localhost:5173/auth/callback` en développement.

### Permissions nécessaires et invitation

Le bot n'a **pas** besoin de la permission Administrateur (principe du moindre privilège). Générez le lien d'invitation avec les permissions minimales :

```bash
npm run invite-url
```

| Permission | Utilisée pour |
| --- | --- |
| Voir les salons, Envoyer des messages, Intégrer des liens, Joindre des fichiers, Voir l'historique | Réponses, logs, transcripts |
| Gérer les messages | `/clear`, suppression du spam et du phishing |
| Gérer les salons | Tickets, `/slowmode` |
| Gérer les rôles | Vérification, quarantaine, lockdown, anti-nuke |
| Gérer le serveur | Lockdown (niveau de vérification, suspension des invitations) |
| Expulser, Bannir, Exclure temporairement | Modération |
| Voir les logs du serveur | Anti-nuke, auteur des actions, ajout de bots |
| Mentionner @everyone | Annonces avec mention |

> ⚠️ **Hiérarchie** : placez le rôle du bot **au-dessus** des rôles qu'il doit gérer (Non vérifié, Membre, rôles des membres à sanctionner). Discord interdit à un bot d'agir sur un rôle supérieur ou égal au sien.

---

## Variables d'environnement

Tous les secrets se trouvent dans `.env`, qui n'est jamais commité (voir `.gitignore`). Le modèle est dans `.env.example`.

| Variable | Requis | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | bot + dashboard | Token du bot |
| `CLIENT_ID` | bot + dashboard | Application ID |
| `CLIENT_SECRET` | dashboard | Secret OAuth2 |
| `DATABASE_URL` | oui | URL PostgreSQL, par exemple `postgresql://user:pass@localhost:5432/coderouge?schema=public` |
| `DASHBOARD_URL` | dashboard | URL publique du dashboard (OAuth2 et contrôle d'origine CSRF) |
| `DASHBOARD_PORT` | non | Port de l'API, 3000 par défaut |
| `SESSION_SECRET` | dashboard | ≥ 32 caractères aléatoires : `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `DEV_GUILD_ID` | non | Enregistre les commandes sur ce seul serveur au démarrage (instantané, pratique en développement) |
| `ENABLE_PRESENCE_INTENT` | non | `true` pour afficher les membres en ligne |
| `LOG_LEVEL` | non | `info` par défaut |
| `NODE_ENV` | non | `development` ou `production` |

Les variables sont validées au démarrage avec Zod. Si l'une manque, le processus s'arrête avec un message clair qui n'affiche jamais les valeurs.

---

## Base de données

Avec Docker :

```bash
docker compose up -d postgres
```

Ou avec un PostgreSQL existant, en créant la base et en renseignant `DATABASE_URL`. Appliquez ensuite les migrations :

```bash
npm run db:deploy      # applique les migrations existantes
# en développement, après une modification de prisma/schema.prisma :
npm run db:migrate
```

Modèles principaux : `Guild`, `GuildSettings` (configuration JSON et score de sécurité), `User`, `MemberProfile`, `Warning`, `ModerationAction`, `SecurityEvent`, `Ticket`, `TicketMessage`, `Announcement`, `AuditLog`, `Whitelist`, `Blacklist`, `LockdownState`, `GuildStatistics`, `DashboardSession`.

---

## Lancement en développement

```bash
npm run deploy-commands   # enregistre les commandes (sur DEV_GUILD_ID, ou --global)
npm run dev:bot           # bot (rechargement automatique)
npm run dev:api           # API du dashboard sur :3000
npm run dev:web           # dashboard sur http://localhost:5173 (proxy vers l'API)
```

En développement, `DASHBOARD_URL=http://localhost:5173` et la redirection OAuth2 est `http://localhost:5173/auth/callback`.

> Les commandes **globales** (`npm run deploy-commands -- --global`) peuvent mettre jusqu'à une heure à apparaître. Les commandes enregistrées sur un serveur (`DEV_GUILD_ID`) apparaissent immédiatement.

---

## Build et production

```bash
npm run build          # client Prisma + compilation TypeScript + dashboard
npm run db:deploy
npm run start:bot      # node dist/bot/index.js
npm run start:api      # node dist/dashboard/index.js (sert aussi le dashboard compilé)
```

En production, l'API sert le frontend compilé (`dashboard/frontend/dist`) sur la même origine. Placez-la derrière un reverse proxy HTTPS (Caddy, Nginx…) et réglez `DASHBOARD_URL=https://dashboard.example.com`. Les cookies passent automatiquement en `Secure`.

Exemple avec PM2 :

```bash
pm2 start dist/bot/index.js --name code-rouge-bot
pm2 start dist/dashboard/index.js --name code-rouge-dashboard
```

---

## Déploiement avec Docker

```bash
cp .env.example .env    # renseignez les secrets
docker compose --profile app up -d --build
```

Cette commande lance PostgreSQL, applique les migrations (service `migrate`), puis démarre `bot` et `dashboard` (port 3000, lié à 127.0.0.1 : exposez-le via un reverse proxy HTTPS). Les conteneurs tournent avec un utilisateur non root.

---

## Configuration d'un serveur

1. Invitez le bot, puis placez son rôle au-dessus des rôles à gérer.
2. **Logs** : `/config set logs.securityChannelId #logs-securite` (idem pour `moderationChannelId`, `membersChannelId`, `serverChannelId`, `ticketsChannelId`), ou depuis *Dashboard → Logs*.
3. **Rôles d'équipe** : `permissions.moderatorRoleIds`, `permissions.supportRoleIds`. `permissions.adminRoleIds` est réservé au propriétaire.
4. **Vérification** : créez les rôles « Non vérifié » (sans accès aux salons membres) et « Membre », renseignez `verification.unverifiedRoleId`, `verification.memberRoleId` et `verification.enabled true`, puis lancez `/verify setup #verification`.
5. **Lockdown** : renseignez `lockdown.sensitiveChannelIds` (salons généraux, vocaux…).
6. **Tickets** : `tickets.categoryChannelId`, `tickets.staffRoleIds`, puis `/ticket panel #support`.
7. Testez avec `/security test raid` et vérifiez `/security status`.

Toute la configuration (seuils, sanctions, points du moteur de risque…) est modifiable dans *Dashboard → Sécurité / Modération / Paramètres* ou exportable et importable en JSON (`/config export`, `/config import`).

---

## Commandes

La documentation complète se trouve dans **[docs/COMMANDS.md](docs/COMMANDS.md)**.

`/ban` `/unban` `/kick` `/timeout` `/untimeout` `/warn` `/warnings` `/clearwarnings` `/clear` `/slowmode` `/lockdown` `/unlock` `/security status|test|reset` `/whitelist-domain` `/blacklist-domain` `/config view|set|reset|export|import` `/announce` `/verify setup|user` `/ticket open|close|add|panel` `/server` `/stats` `/help`

---

## Sécurité

- **Secrets** : uniquement dans `.env` (ignoré par Git). Les logs masquent les tokens Discord, l'URL de la base et les secrets connus. Les réponses de l'API n'exposent jamais ces valeurs.
- **Permissions vérifiées à trois niveaux** : par Discord (permissions par défaut des commandes), par le bot (niveau recalculé à chaque commande) et par le dashboard (niveau recalculé côté serveur via l'API Discord avec le token du bot, jamais à partir de données du navigateur).
- **Clés sensibles réservées au propriétaire** : rôles administrateurs, utilisateurs de confiance de l'anti-nuke, activation de l'anti-nuke.
- **Dashboard** :
  - OAuth2 avec paramètre `state` (comparaison à temps constant) ;
  - cookie de session signé, `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS ; seul le haché SHA-256 du jeton est stocké, et le jeton OAuth2 Discord n'est pas conservé ;
  - contrôle de l'origine sur toutes les requêtes modifiantes (CSRF) ;
  - rate limiting (120 requêtes/min, 10/min sur l'authentification) ;
  - en-têtes de sécurité (Helmet, CSP) et validation Zod de toutes les entrées ;
  - transcripts servis en sandbox.
- **Actions irréversibles** : jamais sans configuration explicite (ban anti-nuke, kick anti-bot). Par défaut, les mitigations sont réversibles.
- **Robustesse** : chaque commande et chaque événement est isolé. Une erreur utilisateur ou de l'API Discord produit un message clair, jamais un crash. Les erreurs techniques sont journalisées.

---

## Tests et qualité

```bash
npm run typecheck   # TypeScript (bot, API, dashboard)
npm run lint        # ESLint
npm test            # Vitest
npm run build
```

Les tests couvrent :

- les permissions et la hiérarchie ;
- la configuration (valeurs par défaut, validation, conversion des saisies) ;
- l'anti-spam (fenêtres glissantes, doublons, tolérance, récidive) ;
- l'anti-raid, le moteur de risque (niveaux, décroissance), l'anti-nuke, l'anti-alt, l'anti-bot et l'anti-phishing ;
- l'escalade des warns, le mode simulation, l'échappement des transcripts et les annonces ;
- les durées et les dates ;
- l'intégration **PostgreSQL** (configuration, listes, statistiques, numérotation atomique, audit) ;
- l'**API du dashboard** : OAuth2, sessions, CSRF, permissions, clés réservées, rate limiting, validation.

Les tests d'intégration utilisent `DATABASE_URL` (migrations appliquées). Définissez `SKIP_DB_TESTS=1` pour les ignorer.

---

## Dépannage

| Problème | Solution |
| --- | --- |
| `Configuration du bot invalide (.env)` | Une variable manque ou est invalide : le message indique laquelle. |
| `An invalid token was provided` | Régénérez le token dans *Developer Portal → Bot* et mettez à jour `DISCORD_TOKEN`. |
| `Used disallowed intents` | Activez *Server Members Intent* et *Message Content Intent* dans le Developer Portal (et *Presence* si `ENABLE_PRESENCE_INTENT=true`). |
| Les commandes n'apparaissent pas | Lancez `npm run deploy-commands`. Les commandes globales peuvent mettre jusqu'à 1 h ; utilisez `DEV_GUILD_ID` en développement. |
| « Je n'ai pas les permissions nécessaires » | Vérifiez les permissions du bot et que son rôle est **au-dessus** du rôle ciblé. |
| La vérification ne donne pas le rôle | Les rôles Membre et Non vérifié doivent être sous le rôle du bot. |
| Les logs n'apparaissent pas | Configurez les salons (`logs.*ChannelId`). Le bot doit pouvoir voir le salon, y écrire et y intégrer des liens. |
| Anti-nuke inactif | Le bot doit avoir la permission *Voir les logs du serveur*. |
| Dashboard : « État OAuth2 invalide » | Recommencez la connexion. La redirection OAuth2 doit correspondre exactement à `<DASHBOARD_URL>/auth/callback`. |
| Dashboard : aucun serveur listé | Le bot doit être sur le serveur et vous devez y avoir au moins le niveau Support. Après un changement de rôle, déconnectez-vous puis reconnectez-vous. |
| Dashboard : « Origine de la requête refusée » | `DASHBOARD_URL` doit correspondre exactement à l'URL utilisée dans le navigateur (schéma, domaine, port). |
| `Can't reach database server` | PostgreSQL est-il démarré ? `DATABASE_URL` est-il correct ? |

---

## Limites connues

- **Restauration après un nuke** : le bot détecte, bloque l'auteur et **conserve le détail** des salons et rôles supprimés (nom, type, modifications) dans les événements de sécurité. Il ne recrée pas automatiquement les salons supprimés : les messages et certains réglages ne peuvent pas être restaurés via l'API Discord, et une recréation automatique pourrait être détournée.
- **Lockdown depuis le dashboard** : il se déclenche et se lève sur Discord (`/lockdown`, `/unlock`) ou automatiquement par le moteur de risque. Le dashboard en affiche l'état.
- **Liste de phishing intégrée** : elle sert de socle. Complétez-la par serveur avec `/blacklist-domain` ; les heuristiques couvrent les variantes inconnues.
