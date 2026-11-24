# App resources

- `app_icon.png` — the app icon. `app.config.ts` also uses it as the splash
  image, so there is no separate splash asset.

`app.config.ts` wires it up:

```ts
export default {
  appIcon: './resource/app_icon.png',
  plugin: [
    ['splash-screen', {
      backgroundColor: '#232323',
      image: './resource/app_icon.png',
      dark: { image: './resource/app_icon.png', backgroundColor: '#000000' },
      imageWidth: 200,
    }],
  ],
}
```

Add your own images to this folder and point `appIcon` / the splash `image`
paths at them if you want a different icon or splash screen.
