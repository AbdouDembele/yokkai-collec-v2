# Tester l’administration des cartes en local

Cette procédure utilise uniquement Supabase local. Elle ne modifie ni le VPS ni la base de production.

## Premier démarrage

1. Redémarrer Windows après l’activation de WSL 2.
2. Ouvrir Docker Desktop et attendre que le moteur soit prêt.
3. Ouvrir PowerShell dans le dépôt puis rendre Node portable disponible :

   ```powershell
   $env:Path = (Resolve-Path '.\.tools\node-v24.19.0-win-x64').Path + ';' + $env:Path
   ```

4. Démarrer Supabase et appliquer toutes les migrations :

   ```powershell
   npx supabase start
   npx supabase status -o env
   ```

5. Créer `.env.local` à partir de `.env.example` avec les valeurs affichées :

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<valeur ANON_KEY>
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   SUPABASE_SERVICE_ROLE_KEY=<valeur SERVICE_ROLE_KEY>
   MAINTENANCE_MODE=false
   ```

6. Lancer le site :

   ```powershell
   npm run dev
   ```

7. Créer un compte sur `http://localhost:3000/signup`, puis lui accorder le rôle admin :

   ```powershell
   npm run admin:grant -- --email ton-email@example.com
   ```

8. Se connecter puis ouvrir `http://localhost:3000/admin/cards`.

## Vérifications de sécurité

- Un visiteur non connecté est renvoyé vers la connexion.
- Un utilisateur connecté non-admin reçoit une page introuvable.
- Un admin peut ajouter une carte par URL ou fichier, importer un CSV, modifier et supprimer une carte non utilisée.
- Une carte déjà possédée ou présente dans un Decision Pack ne peut pas être supprimée.
- Chaque opération est enregistrée dans `admin_audit_logs`.

Pour arrêter l’environnement local :

```powershell
npx supabase stop
```
