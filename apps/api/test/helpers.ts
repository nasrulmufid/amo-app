import { buildApp } from '../src/app'

/** Bangun app baru per test file. `app.inject()` = request tanpa port nyata → cepat & terisolasi. */
export const makeApp = () => buildApp()
