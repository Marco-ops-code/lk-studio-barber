# LK Studio BarberShop

Espace de gestion et de réservation pour le salon LK Studio BarberShop.

## Démarrage rapide

```bash
npm install
cp .env.example .env   # ou copiez manuellement sur Windows
npm start
```

Ouvrez [http://localhost:3000](http://localhost:3000)

## Fonctionnalités

- **Réservation client** — calendrier, créneaux horaires, dépôt
- **Tableau de bord admin** — statistiques et prochains RDV
- **Agenda** — liste complète des réservations
- **Paramètres** — horaires, pattern d'ouverture, message d'accueil
- **Thème sombre / clair** — palette or (#d4af37) conservée

## Connexion admin

Mot de passe par défaut : `admin123` (modifiable via `ADMIN_PASSWORD` dans `.env`)

## Structure

```
├── server.js          # API Express
├── data/store.json    # Données persistées
├── public/
│   ├── index.html
│   ├── assets/logo.png
│   ├── css/styles.css
│   └── js/app.js
└── LK.HTML            # Ancien prototype (conservé)
```

## Phases implémentées

| Phase | Contenu |
|-------|---------|
| **1–2** | Design, wizard réservation, confirmation |
| **3** | Clients, notes, export CSV, blocage créneaux, stats avancées |
| **4** | Stripe Checkout (si clés `.env`) — sinon simulation |
| **5** | Email SMTP + SMS Twilio (optionnel) — sinon journal local + rappels J-1 |

## Configuration Stripe (Phase 4)

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_URL=http://localhost:3000
```

## Configuration notifications (Phase 5)

```env
SMTP_HOST=smtp.gmail.com
SMTP_USER=votre@email.com
SMTP_PASS=mot_de_passe_app
SMTP_FROM="LK Studio <noreply@lkstudio.fr>"
```

Sans SMTP : les messages sont enregistrés dans `data/notifications.json`.

## API (nouvelles routes)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/settings` | Paramètres publics |
| GET | `/api/bookings` | Liste des réservations |
| POST | `/api/create-booking-intent` | Créer une réservation |
| POST | `/api/confirm-booking` | Confirmer après paiement |
| POST | `/api/cancel-booking` | Annuler (client) |
| POST | `/api/admin/login` | Auth admin |
| GET | `/api/stats` | Statistiques (admin) |
| PUT | `/api/admin/settings` | Modifier paramètres (admin) |
| DELETE | `/api/admin/bookings/:id` | Annuler (admin) |
| GET | `/api/admin/export/agenda` | Export CSV (admin) |
| PUT | `/api/admin/clients/:phone/notes` | Notes client (admin) |
| GET | `/api/admin/notifications` | Journal notifications (admin) |
| GET | `/api/payment/verify` | Vérifier paiement Stripe |
| POST | `/api/stripe/webhook` | Webhook Stripe |

## Déploiement via GitHub

Le dépôt est configuré pour travailler directement sur GitHub :

**Dépôt :** https://github.com/Marco-ops-code/lk-studio-barber

### Workflows GitHub Actions

| Fichier | Rôle |
|---------|------|
| `.github/workflows/ci.yml` | Vérifie le projet à chaque push/PR |
| `.github/workflows/deploy-render.yml` | Déploie sur Render (si secret configuré) |
| `.github/workflows/azure-webapps-node.yml` | Option Azure (si secret configuré) |

### Base de données en production

Les données (réservations, paramètres) sont stockées dans des fichiers JSON.
En production, définissez `DATA_DIR=/var/data` pour un stockage persistant
(le dossier `data/` du dépôt sert de modèle initial).

### Déployer sur Render (recommandé)

1. Créez un compte sur [render.com](https://render.com)
2. **New → Blueprint** → connectez le dépôt GitHub `lk-studio-barber`
3. Render lit `render.yaml` (disque persistant 1 Go sur `/var/data`)
4. Ajoutez les variables d'environnement (`ADMIN_PASSWORD`, `APP_URL`, Stripe, SMTP…)
5. Optionnel : copiez le **Deploy Hook** Render dans les secrets GitHub `RENDER_DEPLOY_HOOK`

Chaque push sur `main` déclenche alors la CI, puis le déploiement automatique.
