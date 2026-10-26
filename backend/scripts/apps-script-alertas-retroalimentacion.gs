// =============================================================================
// Alertas automáticas de Retroalimentación — App Promotores
// =============================================================================
// QUÉ HACE: cada vez que corre (por un trigger de tiempo, ver instrucciones
// abajo), revisa si hay filas NUEVAS en la pestaña "Retroalimentacion" desde
// la última vez que corrió. Si las hay, y "AlertasRetroConfig" dice
// Activo=SI, manda:
//   - un correo (Gmail, con MailApp — no necesita SMTP) a cada fila de
//     "AlertasRetroDestinatarios",
//   - un push a https://ntfy.sh/<TemaNtfy> (léelo también de
//     "AlertasRetroConfig") para quien esté suscrito a ese tema en la app
//     ntfy (iOS/Android) o la web.
//
// Ambas pestañas de configuración las administra el admin desde el tablero
// de App Promotores (botón de la campanita "Alertas de Retroalimentación"),
// así que normalmente NO hace falta tocarlas a mano aquí.
//
// CÓMO INSTALARLO (una sola vez):
//   1. Abre el Google Sheet "BBDD Promotores".
//   2. Menú Extensiones -> Apps Script.
//   3. Borra el contenido de Code.gs (o crea un archivo nuevo) y pega TODO
//      este archivo.
//   4. Guarda (ícono de disco o Ctrl/Cmd+S).
//   5. En el panel izquierdo, ícono del reloj ("Activadores" / "Triggers").
//   6. "+ Añadir activador" (Add Trigger):
//        Función a ejecutar: revisarRetroalimentacionNueva
//        Fuente del evento: Basado en tiempo (Time-driven)
//        Tipo: Temporizador por minutos -> Cada 5 minutos
//   7. Guarda. La primera vez te va a pedir autorizar permisos (leer el
//      Sheet, mandar correo, y hacer solicitudes a servicios externos como
//      ntfy.sh) — acéptalos con tu cuenta de Google.
//
// Nota: la PRIMERA vez que corre no manda nada (solo "marca" la fila actual
// como el punto de partida), para no reenviar todo el historial viejo de
// retroalimentación de golpe. A partir de la segunda corrida, solo avisa de
// lo nuevo.
// =============================================================================

const HOJA_RETRO = "Retroalimentacion";
const HOJA_CONFIG = "AlertasRetroConfig";
const HOJA_DESTINATARIOS = "AlertasRetroDestinatarios";
const PROP_ULTIMA_FILA = "retro_ultima_fila_vista";

function revisarRetroalimentacionNueva() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaRetro = ss.getSheetByName(HOJA_RETRO);
  if (!hojaRetro) return; // la pestaña todavía no existe

  const props = PropertiesService.getScriptProperties();
  const totalFilas = hojaRetro.getLastRow();
  // Primera corrida: no hay "última vista" guardada -> se toma el total
  // ACTUAL como punto de partida (no se reenvía el historial).
  const ultimaVista = Number(props.getProperty(PROP_ULTIMA_FILA) || totalFilas);

  if (totalFilas <= ultimaVista) return; // nada nuevo desde la última corrida

  const nuevasFilas = hojaRetro.getRange(ultimaVista + 1, 1, totalFilas - ultimaVista, 7).getValues();

  // Se marca como "visto" ANTES de mandar los avisos: si algo falla al
  // enviar, no se reintenta en bucle infinito la próxima corrida.
  props.setProperty(PROP_ULTIMA_FILA, String(totalFilas));

  const config = leerConfig(ss);
  if (!config.activo) return; // apagado desde el tablero: no manda nada

  const destinatarios = leerDestinatarios(ss);

  nuevasFilas.forEach(function (fila) {
    const registradoEn = fila[0];
    const idPromotor = fila[1];
    const nombre = fila[2];
    const sucursal = fila[3];
    const descripcion = fila[4];
    const ubicacion = fila[6];

    const asunto = "Nuevo reporte de retroalimentación — " + (sucursal || "sin sucursal");
    const cuerpo =
      "Promotor: " + (nombre || idPromotor) + "\n" +
      "Sucursal: " + sucursal + "\n" +
      "Fecha: " + registradoEn + "\n\n" +
      descripcion +
      (ubicacion ? "\n\nUbicación: " + ubicacion : "");

    destinatarios.forEach(function (d) {
      try {
        MailApp.sendEmail(d.email, asunto, cuerpo);
      } catch (e) {
        Logger.log("Error enviando correo a " + d.email + ": " + e.message);
      }
    });

    if (config.temaNtfy) {
      try {
        UrlFetchApp.fetch("https://ntfy.sh/" + config.temaNtfy, {
          method: "post",
          payload: cuerpo,
          headers: {
            // Título sin acentos a propósito: ntfy exige headers en ASCII.
            Title: "Nuevo reporte - " + (sucursal || "sin sucursal"),
            Priority: "high",
          },
          muteHttpExceptions: true,
        });
      } catch (e) {
        Logger.log("Error enviando push a ntfy: " + e.message);
      }
    }
  });
}

function leerConfig(ss) {
  const hoja = ss.getSheetByName(HOJA_CONFIG);
  if (!hoja) return { activo: false, temaNtfy: "" };
  const fila = hoja.getRange(2, 1, 1, 2).getValues()[0];
  return {
    activo: String(fila[0]).trim().toUpperCase() === "SI",
    temaNtfy: String(fila[1] || "").trim(),
  };
}

function leerDestinatarios(ss) {
  const hoja = ss.getSheetByName(HOJA_DESTINATARIOS);
  if (!hoja) return [];
  const filas = hoja.getDataRange().getValues().slice(1); // sin encabezado
  return filas.filter(function (f) { return f[1]; }).map(function (f) {
    return { nombre: f[0], email: f[1] };
  });
}
