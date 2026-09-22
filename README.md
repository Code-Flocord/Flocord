# Flocord

Flocord est un client Discord modifié, dérivé de [Vencord](https://github.com/Vendicated/Vencord) et [Equicord](https://github.com/Equicord/Equicord), développé et maintenu indépendamment par [Code-Flocord](https://github.com/Code-Flocord).

## Installation

Télécharge et lance l'installeur depuis les releases de [FlocordCLI](https://github.com/Code-Flocord/FlocordCLI/releases/latest) :

- **Windows** → `FlocordCLI.exe`

L'installeur détecte automatiquement Discord, Discord PTB et Discord Canary.

## Plugins Flocord

Flocord embarque environ 350 plugins : la base Vencord, une sélection de plugins hérités d'Equicord, et une couche de plugins exclusifs orientés vocal, stream et vie privée. Dans les paramètres, le filtre **"Show Flocord Exclusives"** liste ces derniers.

Quelques exclusifs :

| Plugin | Description |
|---|---|
| STEREO / RipCordStereoFixed / StereoScreenshareAudio | Stéréo en vocal et en screenshare |
| AntiStereo | Force le mono en sortie audio |
| BetterMicrophone | Paramètres microphone avancés |
| ChannelVolume / NormaliserVolume / AudioLimiter | Contrôle et normalisation du volume |
| LightcordBitrate | Débride les limites de bitrate |
| FakeDeafen | Paraître sourd/muet sans l'être |
| InvisibleAsDnd | Comportement "Ne pas déranger" en étant invisible |
| StreamBlurPrivacy / StreamProof / NoDMWhileStreaming | Protection de la vie privée pendant un stream |
| CustomStreamTopQ | Image de prévisualisation de stream personnalisée |
| AutoUnmute / AFK / AutoAFK | Automatisations de statut et de vocal |
| AntiGroup / AntiMove / AntiNickname / AntiDisconnect | Protections contre les actions non désirées |
| GroupKicker / LockGroup / CloseAllDms / LeaveAllGroups | Gestion des groupes et DMs |
| AutoDeleter / MessageCleaner / DoubleClickAntiLog | Gestion de messages |
| ChatGPT | Intégration ChatGPT |
| GpuBinder | Force Discord sur un GPU précis |

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
pnpm buildStandalone
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
