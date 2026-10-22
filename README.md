# Soundpad

Una soundboard che gira in locale nel browser: registri suoni dal microfono (o importi file audio) e li riproduci cliccando sui pad o con scorciatoie da tastiera.

## Avvio

Serve solo Node.js (nessuna dipendenza da installare):

```bash
npm start
```

Poi apri <http://localhost:5173>. La porta si cambia con `PORT=8080 npm start`.

> Il microfono funziona solo su `localhost` o HTTPS, per questo l'app va servita dal server incluso e non aperta come file.

## Uso

| Azione | Come |
| --- | --- |
| Registrare un suono | pulsante **Registra** o tasto `R` (di nuovo per fermare) |
| Importare un file audio | **Importa audio** |
| Riprodurre | clic sul pad o la sua scorciatoia |
| Assegnare una scorciatoia | **Tasto** sul pad, poi premi il tasto desiderato (`Backspace` la rimuove, `Esc` annulla) |
| Rinominare / loop / eliminare | pulsanti **Nome**, **Loop**, **✕** sul pad |
| Fermare tutto | **Ferma tutto** o `Esc` |

I suoni restano salvati nel browser (IndexedDB), quindi li ritrovi alla riapertura, ma sono legati a quel browser su quel PC.
