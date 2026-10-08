# Commandes de Code Rouge

Toutes les commandes sont des commandes slash, disponibles uniquement sur un serveur.
Chaque commande vérifie **trois niveaux de permissions** :

1. **Discord** : permission par défaut de la commande (masquée aux membres non autorisés, modifiable dans *Paramètres du serveur → Intégrations*).
2. **Bot** : niveau interne (OWNER / ADMIN / MODERATOR / SUPPORT / MEMBER), recalculé à chaque utilisation.
3. **Hiérarchie** : le bot refuse toute sanction contre le propriétaire, soi-même, le bot ou un membre de rang supérieur ou égal (celui du modérateur ou du bot).

| Niveau | Obtenu par |
| --- | --- |
| OWNER | Propriétaire du serveur |
| ADMIN | Permission *Administrateur* ou *Gérer le serveur*, ou rôle listé dans `permissions.adminRoleIds` |
| MODERATOR | Permission *Bannir*, *Expulser* ou *Exclure temporairement*, ou rôle listé dans `permissions.moderatorRoleIds` |
| SUPPORT | Rôle listé dans `permissions.supportRoleIds` |
| MEMBER | Tous les autres |

Les actions dangereuses affichent une **confirmation à deux boutons** (🔨 Confirmer / ❌ Annuler). Seul l'auteur de la commande peut y répondre, et les boutons expirent au bout de 30 secondes.

## Modération

| Commande | Niveau | Description |
| --- | --- | --- |
| `/ban utilisateur [raison] [duree] [supprimer_messages]` | MODERATOR | Bannit un membre ou un ID. Si une durée est donnée (`7j`, `12h`…), le ban est temporaire et sera levé automatiquement. Confirmation configurable (`moderation.confirmBan`). |
| `/unban utilisateur_id [raison]` | MODERATOR | Lève un bannissement. L'option propose les bans existants en autocomplétion. |
| `/kick membre [raison]` | MODERATOR | Expulse un membre (confirmation configurable). |
| `/timeout membre duree [raison]` | MODERATOR | Exclusion temporaire (28 jours maximum). |
| `/untimeout membre [raison]` | MODERATOR | Lève une exclusion temporaire. |
| `/warn membre raison` | MODERATOR | Avertit un membre. La sanction automatique du palier atteint s'applique. |
| `/warnings utilisateur` | SUPPORT | Liste les avertissements (actifs et inactifs). |
| `/clearwarnings utilisateur [avertissement] [raison]` | MODERATOR | Désactive un avertissement précis ou tous (avec confirmation). |
| `/clear nombre [membre]` | MODERATOR | Supprime jusqu'à 100 messages récents (moins de 14 jours), éventuellement d'un seul membre. |
| `/slowmode secondes [salon] [raison]` | MODERATOR | Règle le mode lent (0 pour le désactiver). |

Chaque sanction reçoit un **numéro de cas**. Elle est enregistrée en base (cible, modérateur, type, raison, date, durée, résultat), publiée dans le salon de logs de modération et inscrite au journal d'audit. Le membre est prévenu en MP si `moderation.dmOnSanction` est activé.

### Escalade des avertissements (par défaut)

| Warns actifs | Sanction automatique |
| --- | --- |
| 1 | — |
| 2 | Timeout 10 minutes |
| 3 | Timeout 1 heure |
| 4 | Kick |
| 5 et plus | Ban |

Ces paliers se modifient dans le dashboard (*Modération → Réglages*) ou avec `/config set moderation.warnThresholds`, au format JSON.

## Sécurité

| Commande | Niveau | Description |
| --- | --- | --- |
| `/security status` | MODERATOR | Niveau de menace, score, modules actifs, lockdown, événements des dernières 24 h. |
| `/security test scenario` | ADMIN | **Mode simulation** (`raid`, `spam`, `nuke`, `phishing`, `alt`) : rejoue le scénario dans les vrais moteurs de détection avec la configuration du serveur. Aucune action réelle n'est effectuée. |
| `/security reset` | ADMIN | Remet le score de menace à 0 (avec confirmation). |
| `/lockdown raison` | ADMIN | Active le lockdown (avec confirmation, voir ci-dessous). |
| `/unlock [raison]` | ADMIN | Lève le lockdown et restaure exactement la configuration précédente. |
| `/whitelist-domain add\|remove\|list` | ADMIN (list : MODERATOR) | Domaines toujours autorisés. Accepte aussi un lien d'invitation (`discord.gg/xxx`), alors autorisé. |
| `/blacklist-domain add\|remove\|list` | ADMIN (list : MODERATOR) | Domaines toujours bloqués. |

### Ce que fait le lockdown

Chaque mesure est enregistrée dans un instantané puis restaurée par `/unlock` :

- le niveau de vérification Discord passe à « Élevé » (`lockdown.raiseVerificationLevel`) ;
- les invitations du serveur sont suspendues (`lockdown.pauseInvites`) ;
- les salons sensibles (`lockdown.sensitiveChannelIds`) deviennent invisibles pour le rôle non vérifié, ou en lecture seule pour @everyone si aucun rôle non vérifié n'est configuré ;
- les membres arrivés dans les N dernières minutes et toutes les nouvelles arrivées reçoivent le rôle non vérifié ;
- les rôles d'alerte sont mentionnés dans le salon de sécurité, et le propriétaire est prévenu en MP.

## Administration

| Commande | Niveau | Description |
| --- | --- | --- |
| `/config view [section]` | ADMIN | Affiche la configuration du serveur. |
| `/config set cle valeur` | ADMIN | Modifie une valeur. La clé est proposée en autocomplétion. Salons et rôles : mention ou ID. Listes : valeurs séparées par des virgules. `none` vide la valeur. |
| `/config reset section` | ADMIN | Réinitialise une section (avec confirmation). |
| `/config export` | ADMIN | Télécharge la configuration au format JSON. |
| `/config import fichier` | ADMIN | Remplace la configuration par un fichier JSON, après validation et confirmation. |
| `/announce salon description [options…]` | ADMIN | Crée une annonce en embed (titre, couleur, image, miniature, footer, auteur, mention, bouton lien). Un **aperçu** s'affiche avec les boutons *Aperçu*, *Publier* (ou *Programmer* si l'option `programmer` est remplie) et *Annuler*. |
| `/verify setup [salon]` | ADMIN | Publie le message de vérification avec le bouton ✅ *Vérifier mon compte*. |
| `/verify user membre` | MODERATOR | Vérifie un membre manuellement. |

Les clés `permissions.adminRoleIds`, `antiNuke.trustedUserIds` et `antiNuke.enabled` ne peuvent être modifiées que par le **propriétaire du serveur**, aussi bien sur Discord que sur le dashboard.

## Tickets

| Commande | Niveau | Description |
| --- | --- | --- |
| `/ticket open categorie [sujet]` | MEMBER | Ouvre un ticket : 🛠️ Support, 🚨 Signalement, 🤝 Partenariat, 💬 Question, 🛒 Achat ou 📋 Autre. |
| `/ticket close [raison]` | Équipe ou créateur | Ferme le ticket, génère le transcript HTML (base de données + salon de logs des tickets) et verrouille le salon. |
| `/ticket add membre` | Équipe ou créateur | Ajoute un membre au ticket. |
| `/ticket panel salon` | ADMIN | Publie un panneau avec un menu de sélection de catégorie. |

Chaque ticket propose les boutons **Prendre en charge**, **Ajouter un membre**, **Fermer** (la raison est demandée dans un formulaire) et **Supprimer** (équipe uniquement, avec confirmation).

## Informations

| Commande | Niveau | Description |
| --- | --- | --- |
| `/server` | MEMBER | Informations sur le serveur. Le nombre de membres en ligne n'apparaît que si l'intent *Presence* est activé. |
| `/stats` | SUPPORT | Membres, sanctions, messages supprimés, spams, raids, liens bloqués, attaques nuke, vérifications, tickets, niveau de sécurité. |
| `/help` | MEMBER | Liste les commandes accessibles à votre niveau. |
