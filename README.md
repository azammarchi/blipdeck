# Soundpad

Una soundboard che gira in locale nel browser: registri suoni dal microfono (o importi file audio), li ritagli e li riproduci cliccando sui pad o con scorciatoie da tastiera.

## Avvio

Serve solo Node.js (nessuna dipendenza da installare):

```bash
npm start
```

Si apre da solo il browser predefinito su <http://localhost:5173> (se la porta è occupata usa la successiva). La porta si cambia con `PORT=8080 npm start`; per non aprire il browser usa `NO_OPEN=1 npm start`.

> Il microfono funziona solo su `localhost` o HTTPS, per questo l'app va servita dal server incluso e non aperta come file.

## Uso

| Azione | Come |
| --- | --- |
| Registrare un suono | pulsante **Registra** o tasto `R` (di nuovo per fermare) |
| Importare un file audio | **Importa** e scegli uno o più file audio |
| Ritagliare un suono | **Taglia** sul pad: trascina le maniglie gialle, **Anteprima** per ascoltare, **Togli silenzi** per tagliare in automatico i silenzi all'inizio e alla fine, poi **Salva** |
| Riprodurre | clic sul pad o la sua scorciatoia |
| Assegnare una scorciatoia | **Tasto** sul pad, poi premi il tasto desiderato (`Backspace` la rimuove, `Esc` annulla) |
| Rinominare / loop / eliminare | pulsanti **Nome**, **Loop**, **✕** sul pad |
| Fermare tutto | **Ferma tutto** o `Esc` |

Il ritaglio sostituisce l'audio originale (salvato come WAV), quindi non si può annullare dopo il salvataggio.

## Backup e trasferimento

- **Esporta** scarica un file `soundpad-AAAA-MM-GG.json` con tutti i suoni, i nomi, i tasti assegnati, i colori e il loop.
- **Importa** con quel file `.json` li ricarica. Se hai già dei suoni ti chiede se **sostituirli** (OK) o **aggiungere** quelli importati (Annulla); in aggiunta, un tasto già usato resta al suono esistente e quello importato rimane senza scorciatoia.

I suoni restano salvati nel browser (IndexedDB), quindi li ritrovi alla riapertura, ma sono legati a quel browser su quel PC.
