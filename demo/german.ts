import { registerLocale } from "../src/index";

// Any other language takes one call, before or after the widgets are displayed
registerLocale("de", {
	label: "Ich bin kein Roboter",
	verifying: "Überprüfung läuft…",
	verified: "Überprüft",
	expired: "Überprüfung abgelaufen, bitte erneut ankreuzen",
	error: "Überprüfung fehlgeschlagen, zum Wiederholen klicken",
	logo: "Geschützt durch KnCaptcha, ohne Cookies und Tracking",
});
