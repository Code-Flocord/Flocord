# Flocord

Flocord est un client Discord modifié, fork d'[Equicord](https://github.com/Equicord/Equicord) et [Vencord](https://github.com/Vendicated/Vencord), avec des plugins exclusifs développés par [Code-Flocord](https://github.com/Code-Flocord).

## Installation

Télécharge et lance l'installeur depuis les releases de [FlocordCLI](https://github.com/Code-Flocord/FlocordCLI/releases/latest) :

- **Windows** → `FlocordCLI.exe`

L'installeur détecte automatiquement Discord, Discord PTB et Discord Canary.

## Plugins Flocord

Flocord inclut les plugins de Vencord et Equicord, plus une couche de plugins exclusifs accessibles dans les paramètres sous **"Show Flocord"**.

| Plugin | Description |
|---|---|
| STEREO / Ripcord_Stereo | Active le stéréo en screenshare |
| stereoScreenshare | Screenshare en stéréo |
| antiStereo | Désactive le stéréo forcé |
| betterMicrophone | Paramètres microphone avancés |
| channelVolume | Volume individuel par canal vocal |
| normaliserVolume | Normalisation du volume |
| lightcordBitrate | Débride les limites de bitrate |
| fakeDeafen | Paraître sourd/muet sans l'être |
| InvisibleAsDnd | Apparaître "Ne pas déranger" en étant invisible |
| streamBlurPrivacy | Flouter le stream pour la vie privée |
| streamProof | Masque les éléments Flocord lors d'un stream |
| noDMWhileStreaming | Bloque les DMs pendant un stream |
| autoUnmute | Se démute automatiquement |
| afk | Mode AFK automatique |
| antiGroup | Bloque les ajouts en groupe DM |
| antiMove | Empêche d'être déplacé de salon vocal |
| groupKicker | Expulse des membres de groupes DM |
| lockGroup | Verrouille un groupe DM |
| closeAllDms | Ferme tous les DMs ouverts |
| leaveAllGroups | Quitte tous les groupes DMs |
| autoDeleter | Suppression automatique de messages |
| messageCleaner | Nettoyage de messages en masse |
| chatGPT | Intégration ChatGPT |
| customStream | Paramètres de stream personnalisés |
| abreviation | Système d'abréviations personnalisées |
| doubleClickAntiLog | Anti-log sur double clic |
| vencord-gpubinder | Liaison GPU |

## Build depuis les sources

### Prérequis

- [Git](https://git-scm.com/)
- [Node.js LTS](https://nodejs.org/) (≥ 22)
- [pnpm](https://pnpm.io/)

```bash
npm i -g pnpm
```

### Build FlocordCore

```bash
git clone https://github.com/Code-Flocord/Flocord
cd Flocord
pnpm install --frozen-lockfile
pnpm build
```

Le fichier `dist/desktop.asar` est le mod compilé.

### Build FlocordCLI

```bash
git clone https://github.com/Code-Flocord/FlocordCLI
cd FlocordCLI
```

Copie `dist/desktop.asar` dans `assets/` :

```bash
copy ..\Flocord\dist\desktop.asar assets\desktop.asar
```

Compile :

```bash
cargo build --release
```

L'exécutable se trouve dans `target/release/FlocordCLI.exe`.

## Crédits

- [Vendicated](https://github.com/Vendicated) pour [Vencord](https://github.com/Vendicated/Vencord)
- [Equicord](https://github.com/Equicord/Equicord) pour la base de plugins étendue

## Avertissement légal

Discord est une marque déposée de Discord Inc. Flocord n'est pas affilié à Discord Inc.

<details>
<summary>Utiliser Flocord enfreint les conditions d'utilisation de Discord</summary>

Les modifications de client sont contraires aux Conditions d'Utilisation de Discord.

Cependant, Discord est généralement indifférent à ces pratiques et aucun cas de ban connu n'existe pour l'utilisation de mods clients. Reste prudent et n'utilise pas de plugins au comportement abusif.

Si ton compte est critique pour toi, utilise les mods clients à tes propres risques.

</details>
