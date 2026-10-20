# Sumar un comando a comandle

Cada comando del juego es una entrada de [`data/commands.json`](data/commands.json).
El orden del archivo es el calendario: la primera entrada fue el día #1, la
segunda el #2, y así. Por eso:

- **Agregá siempre al final.** Nunca reordenes ni borres entradas: cambiaría el
  comando de días que ya pasaron o del día de hoy.
- Para corregir una entrada existente (un error en un ejemplo, una pista
  confusa), editala en su lugar sin cambiar el `id`.

## Formato

```json
{
  "id": "chmod",
  "category": "permisos",
  "level": "básico",
  "clues": [
    "Decide quién puede leer, escribir o ejecutar un archivo.",
    "Acepta modos en octal, como 755 o 600.",
    "Su nombre viene de «change mode»."
  ],
  "summary": "Cambia los permisos de archivos y directorios.",
  "explanation": "De dos a cuatro oraciones: qué hace, cuándo lo usás y un concepto clave.",
  "examples": [
    { "cmd": "chmod 600 ~/.ssh/id_ed25519", "desc": "Deja la clave privada legible solo por vos." },
    { "cmd": "...", "desc": "..." },
    { "cmd": "...", "desc": "..." }
  ],
  "security": "Una oración sobre el riesgo, el mal uso a evitar o el uso defensivo.",
  "lab": "https://securitylabs.valentorassa.com/labs/<ruta>/<lab>/"
}
```

## Reglas

- `id`: el nombre real del ejecutable, en minúsculas, de 4 a 8 caracteres
  (letras, números o `-`).
- `category`: `archivos`, `texto`, `procesos`, `redes`, `permisos`, `sistema`,
  `seguridad`, `paquetes`, `git` o `contenedores`.
- `level`: `básico`, `intermedio` o `avanzado`.
- **Tres pistas**, de la más vaga a la más concreta, sin escribir el nombre del
  comando.
- **Tres ejemplos** que funcionen y no rompan nada: nada de `rm -rf`, `dd` sobre
  discos ni `chmod 777`. Usá rutas de ejemplo, IPs de documentación
  (`192.0.2.x`, `198.51.100.x`, `203.0.113.x`) y `example.com`.
- Las herramientas de seguridad se explican para auditar sistemas propios o
  con autorización.
- `lab` es opcional: solo si un lab de
  [Open Security Labs](https://securitylabs.valentorassa.com) enseña ese comando.
- Español rioplatense, claro y directo.
- Agregá el `id` a [`data/allowed.txt`](data/allowed.txt) (orden alfabético).
  También podés sumar ahí nombres de comandos reales para que sean intentos
  válidos.

## Probar antes del PR

```bash
go test ./...                      # valida todas las entradas
go run . explicar <tu-comando>     # mirá cómo queda la ficha
```
