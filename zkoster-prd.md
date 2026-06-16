# Zkoster — Product Requirements Document (PRD)

> **Versión:** 0.2 — MVP Hackathon
> **Fecha:** Junio 2026
> **Estado:** Contratos implementados (capa onchain completa y testeada); frontend pendiente.

> **Nota de implementación:** los tres contratos Soroban están construidos, testeados (incluida verificación con pruebas Groth16 reales) y compilando a wasm. Las secciones 10, 11, 13 y 14 reflejan las decisiones de diseño tomadas durante la implementación, que refinan el draft original. Ver `contracts/README.md` para la interfaz pública.

---

## Tabla de Contenidos

1. [Contexto: Hackathon y Ecosistema Stellar](#1-contexto-hackathon-y-ecosistema-stellar)
2. [Tecnologías de Stellar relevantes](#2-tecnologías-de-stellar-relevantes)
3. [El problema](#3-el-problema)
4. [El producto](#4-el-producto)
5. [Cliente ideal (ICP)](#5-cliente-ideal-icp)
6. [Propuesta de valor](#6-propuesta-de-valor)
7. [Flujo general del producto](#7-flujo-general-del-producto)
8. [Roles y journeys](#8-roles-y-journeys)
9. [Pantallas del MVP](#9-pantallas-del-mvp)
10. [Modelo de dominio](#10-modelo-de-dominio)
11. [Arquitectura de contratos (alto nivel)](#11-arquitectura-de-contratos-alto-nivel)
12. [Visibilidad por actor](#12-visibilidad-por-actor)
13. [Reglas de negocio mínimas](#13-reglas-de-negocio-mínimas)
14. [MVP Scope](#14-mvp-scope)
15. [Non-goals del MVP](#15-non-goals-del-mvp)
16. [Pitch de 30 segundos](#16-pitch-de-30-segundos)

---

## 1. Contexto: Hackathon y Ecosistema Stellar

El hackathon está orientado a proyectos que demuestren casos de uso reales sobre Stellar, con énfasis en adopción institucional y privacidad configurable. Los ejes que Stellar está promoviendo activamente en este ciclo son:

- **Privacidad empresarial**: La red de Stellar es pública y transparente por defecto, pero su roadmap (Protocol X-Ray, SPP, confidential tokens) añade privacidad configurable a nivel de aplicación, pensada para payroll, pagos institucionales, settlements y remesas.
- **Enterprise payments**: Stellar posiciona sus rails como infraestructura para disbursements globales, payroll y B2B settlements, con comprobación en producción: más de $1.2B procesados anualmente en payroll/disbursements sobre la red.
- **Compliance-first privacy**: La filosofía de Stellar no es anonimato absoluto, sino *open by default, private when needed* — privacidad selectiva con controles para reguladores y auditores (view keys, association sets, selective disclosure).
- **Stablecoin adoption**: Stellar es una de las redes con mayor tracción en USDC y otras stablecoins para pagos cross-border, remesas y payroll en mercados emergentes.
- **Developer tooling**: El hackathon también valora proyectos que demuestren uso creativo de las primitives ZK disponibles en Stellar, especialmente ZK verifiers onchain, circuitos Noir/Groth16 y contratos Soroban.

### Casos de uso mencionados explícitamente por Stellar

Stellar menciona los siguientes casos como áreas donde la privacidad configurable aporta valor real:

- Payroll y disbursements empresariales.
- Pagos institucionales (B2B settlements).
- Remesas privadas.
- Pagos cotidianos que requieren confidencialidad de montos.
- Gestión de treasury.

Zkoster entra directamente en el primer caso.

---

## 2. Tecnologías de Stellar relevantes

### Protocol X-Ray

Actualización de Stellar (enero 2026) que introduce verificación ZK nativa en el ledger. Permite a los desarrolladores construir aplicaciones de privacidad preservando transparencia y auditabilidad pública. El ledger sigue siendo público y verificable; la privacidad ocurre a nivel de aplicación.

### Stellar Private Payments (SPP)

Pool de privacidad open-source desarrollado por Nethermind sobre Stellar. Permite realizar depósitos, transferencias y retiros de tokens sin revelar montos, relaciones entre partes ni balances. Usa construcciones inspiradas en Zerocash + privacy pools + association sets.

- Funciones: depósito, transferencia in-pool, retiro.
- Oculta: sender, receiver, monto.
- Compliance: association sets para allowlists/denylist + non-membership proofs para exclusión de entidades sancionadas.

### Confidential Tokens / Confidential Transfers

Primitiva alternativa de privacidad en Stellar, adecuada para casos donde las partes pueden ser visibles pero los montos y balances deben permanecer privados. Stellar la describe como especialmente apropiada para **payroll** y **B2B payments**, porque las empresas y empleados pueden ser conocidos, pero los montos salariales no deben ser públicos.

- Oculta: montos de transacción y balances.
- No oculta necesariamente: identidad de las partes.
- Caso de uso natural: payroll enterprise donde las partes se conocen pero los montos son sensibles.

### ZK Verifier Onchain (Soroban)

Contrato Soroban que verifica pruebas ZK directamente onchain. Stellar soporta verificación Groth16 usando BN254/Poseidon, además de circuitos escritos en Noir. Esto permite que contratos de aplicación deleguen la validación matemática al verifier, manteniendo separados la lógica de negocio y la lógica criptográfica.

### Association Sets y Compliance Controls

Sistema de membership trees (Merkle) que permiten demostrar pertenencia o no-pertenencia a un conjunto aprobado, sin revelar otros datos del participante. Stellar lo propone como mecanismo para:

- Allowlists de participantes KYC/AML.
- Exclusión de entidades sancionadas.
- Compliance configurable por aplicación.

Zkoster puede usar este mecanismo para modelar empleados autorizados y políticas de elegibilidad de pago.

### View Keys y Selective Disclosure

Mecanismo mediante el cual una empresa o aplicación puede otorgar acceso de solo lectura a ciertos datos de transacciones a auditores o reguladores, sin exponer el resto. Stellar lo presenta como la herramienta de compliance para empresas que quieren combinar privacidad operacional con responsabilidad ante terceros autorizados.

Zkoster usa este concepto en su módulo de Auditor View y en las entidades `DisclosureGrant`.

### Soroban (Stellar Smart Contracts)

Plataforma de contratos inteligentes de Stellar. Los contratos Zkoster se escriben en Soroban (Rust). Stellar tiene SDKs para TypeScript, Python y Java, además de herramientas de testing y deployment.

---

## 3. El problema

Stellar y otras L1 públicas son transparentes por defecto. Cualquier persona que analice el ledger puede reconstruir:

- Qué empresa paga a quién.
- Con qué frecuencia lo hace.
- Qué montos transfiere.
- Qué relaciones existen entre wallets.

Para una empresa que usa stablecoins en su nómina, esto equivale a publicar el organigrama salarial en internet de forma permanente e irrevocable. Esa transparencia es la principal barrera para la adopción de stablecoin payroll en empresas semi-Web2 o con operaciones globales.

El problema tiene tres dimensiones concretas:

1. **Confidencialidad salarial**: los salarios individuales no deben ser inferibles por terceros, competidores ni entre empleados.
2. **Confidencialidad operacional**: el volumen de nómina, frecuencia de pagos y relaciones empresa-empleado son datos estratégicos.
3. **Compliance**: la privacidad no puede ser opacidad total; auditores, finanzas y reguladores deben poder acceder a información relevante bajo control.

---

## 4. El producto

**Zkoster** = ZK + Roster (nómina/lista).

Zkoster es una *private payroll workspace* para empresas globales que quieren ejecutar nómina en stablecoins sobre Stellar sin exponer montos salariales, estructuras internas ni relaciones de pago en el ledger público. Combina una experiencia de backoffice familiar (subir CSV, aprobar batch, recibir comprobante) con pagos privados onchain y disclosure selectivo para auditoría y compliance.

### Modalidad de producto: Private Batch Payroll

El MVP implementa **private batch payroll**: nómina agrupada en lotes discretos por periodo, liquidada de forma privada. No se implementa streaming payroll en esta fase.

### Diferencial central

> Run stablecoin payroll on Stellar without publishing your salary table to the internet.

---

## 5. Cliente ideal (ICP)

Empresa de **10 a 200 personas**, distribuida internacionalmente, con al menos una de estas condiciones:

- Paga a contractors o empleados en múltiples países con fricción bancaria.
- Ya usa o contempla stablecoins (USDC) para pagos cross-border.
- Tiene equipos remotos y quiere control financiero sin visibilidad pública de salarios.
- Opera en LATAM, África o Sudeste Asiático, donde stablecoin payroll ya está siendo adoptado.

**No es** una DAO pública, ni una empresa cripto-nativa con nómina pública.

**Perfil de usuario interno:**

| Rol | Descripción |
|-----|-------------|
| Admin (Finance/Ops/RR.HH.) | Crea y aprueba batches de nómina. Gestiona la relación con el producto. |
| Empleado | Recibe su pago. Ve solo sus propios datos. Descarga comprobantes. |
| Auditor | Accede a vistas autorizadas de batches o pagos específicos. |

---

## 6. Propuesta de valor

| Para | El valor es |
|------|-------------|
| La empresa | Pagar nómina en stablecoins sin volver públicos los salarios. Controles de compliance y auditoría. |
| El empleado | Experiencia simple de portal de pago. Solo ve su propio sueldo. |
| El auditor | Vista limitada y autorizada para revisar totales e integridad sin acceder a toda la nómina. |
| Los jueces | Caso de uso real + primitives ZK de Stellar + UX enterprise-friendly + problema del mercado validado. |

---

## 7. Flujo general del producto

```
[Admin]
  1. Crea empresa / configura treasury
  2. Crea nuevo batch de nómina (periodo, asset)
  3. Sube CSV con empleados, wallets y montos
  4. Revisa totales y errores
  5. Aprueba el batch
  6. Ejecuta payout privado
  7. Revisa status del batch
  8. Emite DisclosureGrant para auditor si aplica

[Empleado]
  1. Recibe notificación de pago
  2. Entra al portal
  3. Ve su pago, monto, periodo, asset y estado
  4. Descarga/comparte receipt

[Auditor]
  1. Recibe acceso autorizado a un batch
  2. Ve totales del batch y metadata
  3. Revisa pagos autorizados en su scope
  4. Exporta audit summary
```

---

## 8. Roles y journeys

### Admin

El usuario principal de backoffice. No debe necesitar entender ZK ni la infraestructura cripto subyacente. La experiencia debe sentirse como una herramienta de finance/ops.

**Journey:**

1. **Create payroll batch**: nombre, periodo, moneda, fecha estimada.
2. **Upload team payroll**: CSV con empleado, wallet, monto, referencia.
3. **Review totals**: cantidad de pagos, monto total, asset, errores, wallets faltantes.
4. **Approve private payout**: confirmación del lote y ejecución de pagos privados.
5. **Track status**: seguimiento por pago — pending, paid, flagged.
6. **Audit access**: generación de `DisclosureGrant` para un auditor específico.

### Empleado

El receptor del pago. No necesita entender el mecanismo técnico. Solo necesita saber que fue pagado, cuánto, cuándo, y que nadie más puede ver su sueldo.

**Journey:**

1. Accede al portal.
2. Ve su último payout: monto, asset, periodo, estado.
3. Revisa historial personal.
4. Descarga receipt simple.

### Auditor

Actor externo con acceso limitado y autorizado. Su rol refuerza el ángulo "private but compliant".

**Journey:**

1. Recibe acceso a un batch específico.
2. Ve total payroll, asset, periodo, cantidad de destinatarios.
3. Revisa pagos dentro de su scope autorizado.
4. Exporta audit summary con los datos disponibles.

---

## 9. Pantallas del MVP

### Pantalla 1 — Admin Dashboard
- **Objetivo**: visión general de batches activos e historial.
- **Datos**: lista de batches, estado de cada uno, totales, alertas rápidas.
- **CTA principal**: "New Payroll Batch".

### Pantalla 2 — New Payroll Batch
- **Objetivo**: crear un nuevo lote de nómina.
- **Datos**: nombre del batch, periodo (inicio/fin), asset, fecha estimada de pago.
- **CTA principal**: "Create Batch".

### Pantalla 3 — CSV Review & Validation
- **Objetivo**: revisar y validar el lote antes de aprobar.
- **Datos**: tabla de empleados cargados, montos, wallets, errores de validación, total del batch, cantidad de recipients.
- **CTA principal**: "Approve Batch".

### Pantalla 4 — Batch Detail / Payout Status
- **Objetivo**: seguimiento del batch en ejecución.
- **Datos**: estado general del batch, lista de pagos con estado individual (pending / paid / flagged), progreso total.
- **CTA principal**: "Execute Payout" / "Issue Audit Access".

### Pantalla 5 — Employee Payment Portal
- **Objetivo**: experiencia minimalista para el empleado receptor.
- **Datos**: nombre del empleado, último pago (monto, asset, periodo, estado), historial de pagos, botón de receipt.
- **CTA principal**: "Download Receipt".

### Pantalla 6 — Auditor Disclosure View
- **Objetivo**: vista autorizada y limitada para auditoría.
- **Datos**: total del batch, asset, periodo, cantidad de pagos, muestra autorizada de pagos específicos, badge "Read-only Authorized View".
- **CTA principal**: "Export Audit Summary".

---

## 10. Modelo de dominio

> **Decisión de implementación — una instancia = una empresa.** En vez de un modelo multi-tenant con `company_id` propagado por todas las entidades, cada empresa obtiene su propio despliegue del trío de contratos (`initialize(admin)`). Esto alinea con el non-goal "multi-tenancy enterprise de producción" (§15), mantiene las claves de storage limpias y el wiring 1:1:1. Por eso `company_id` es **implícito** (la instancia ES la empresa) y se omite de las entidades onchain. Multi-empresa se resuelve a futuro con un factory.

### Company
Empresa cliente de Zkoster. Onchain se representa como la **configuración de la instancia** de `ZkosterPayroll` (`Config`).

| Campo | Descripción | Implementación |
|-------|-------------|----------------|
| `company_id` | Identificador único | Implícito (la instancia es la empresa) |
| `name` | Nombre de la empresa | Off-chain (metadata del frontend) |
| `treasury` | Wallet desde donde se fondean los batches | `Address` en `Config` |
| `asset` | Token de pago permitido (e.g., USDC SAC) | `Address` único en `Config` |
| `compliance` / `verifier` | Direcciones de los contratos asociados | `Address` en `Config` (wiring) |
| `status` | active / suspended | No modelado en MVP |

### Employee
Receptor de pagos. Onchain se representa como un `Member` con rol `Employee` en `ZkosterCompliance`; el resto es metadata off-chain.

| Campo | Descripción | Implementación |
|-------|-------------|----------------|
| `employee_id` | Identificador único | La `wallet` ES el id (único por instancia) |
| `company_id` | Empresa a la que pertenece | Implícito (instancia) |
| `external_ref` | ID interno de RR.HH. (opcional) | Off-chain |
| `wallet` | Wallet de destino del pago | `Address` (clave del `Member`) |
| `display_name` | Alias interno | Off-chain |
| `eligibility_status` | authorized / revoked | `MemberStatus` (`Authorized`/`Revoked`) + denylist |

### PayrollBatch
Unidad principal de negocio. Representa un ciclo de nómina.

| Campo | Descripción | Implementación |
|-------|-------------|----------------|
| `batch_id` | Identificador único | `u64` autoincremental (`1..=batch_count`) |
| `company_id` | Empresa que crea el batch | Implícito (instancia) |
| `period_start` / `period_end` | Período de nómina | `u64` timestamps |
| `asset` | Token de pago (e.g., USDC) | Definido en `Config` de la instancia, no por batch |
| `total_commitment` | **Commitment Pedersen** del total del batch | `BytesN<64>` — **nunca en claro** (regla #7). El total cleartext vive off-chain |
| `employee_count` | Cantidad de recipients | `u32` |
| `status` | draft → reviewed → approved → funded → processing → paid (+ partially_flagged, closed) | `BatchStatus` |
| `created_by` / `approved_by` | Admins | `Address` / `Option<Address>` |
| `settlement_ref` | Referencia onchain del settlement | `BytesN<32>` |

> El campo `total_payroll` del draft original pasa a ser `total_commitment`: la suma del batch se almacena como **commitment criptográfico**, no como monto en claro.

### Payout
Pago individual dentro de un batch.

| Campo | Descripción | Implementación |
|-------|-------------|----------------|
| `payout_id` | Identificador único | `u64` autoincremental |
| `batch_id` | Batch al que pertenece | `u64` |
| `employee` | Empleado receptor | `Address` (wallet, no un id separado) |
| `amount_commitment` | Commitment Pedersen del monto (no expuesto en claro) | `BytesN<64>` sobre BN254 |
| `status` | pending / ready / submitted / paid / failed / flagged / disclosed | `PayoutStatus` |
| `tx_ref` | Referencia onchain | `BytesN<32>` |
| `receipt_ref` | Referencia del comprobante generado | `BytesN<32>` |
| `disclosure_policy` | Política de visibilidad | **No es campo del payout**: la visibilidad se resuelve vía `DisclosureGrant` en `ZkosterCompliance` |

### DisclosureGrant
Permiso de visibilidad otorgado a un auditor o actor autorizado.

| Campo | Descripción | Implementación |
|-------|-------------|----------------|
| `grant_id` | Identificador único | `u64` autoincremental |
| `batch_id` | Batch al que aplica | `u64` (siempre seteado) |
| `payout_id` | Pago específico (opcional) | `u64`; **`0` = grant de batch completo** (en vez de `null`) |
| `grantee` | Wallet del auditor | `Address` |
| `scope` | totals_only / sample / full_batch | `DisclosureScope` (`Sample` exige `payout_id != 0`) |
| `granted_by` | Admin que emitió el grant | `Address` |
| `expires_at` | Expiración del acceso | `u64` timestamp; **`0` = sin expiración** |
| `revoked` | Estado de revocación | `bool` (agregado en implementación) |

### ComplianceMember
Participante autorizado dentro de una empresa.

| Campo | Descripción | Implementación |
|-------|-------------|----------------|
| `member_id` | Identificador único | La `wallet` ES el id |
| `company_id` | Empresa | Implícito (instancia) |
| `wallet` | Wallet del participante | `Address` (clave) |
| `role` | employee / auditor / admin | `MemberRole` |
| `status` | authorized / revoked | `MemberStatus` |

> Además, `ZkosterCompliance` mantiene una **denylist** explícita de sanciones: una wallet en denylist nunca está autorizada, sin importar su `status`. `is_authorized(wallet)` = miembro `Authorized` **y** no denegado.

---

## 11. Arquitectura de contratos (alto nivel)

Zkoster organiza su lógica onchain en tres módulos:

### Módulo 1: ZkosterPayroll
Contrato principal de orquestación del negocio.

**Responsabilidades:**
- Gestionar treasury de la empresa.
- Crear y administrar batches de nómina.
- Registrar compromisos (commitments) de los payouts.
- Ejecutar liquidaciones privadas.
- Controlar estados del batch y de cada payout.
- Prevenir doble ejecución.
- Registrar receipts y referencias de settlement.

**Relación con otros módulos:** llama al ZkosterVerifier para validar pruebas antes de ejecutar pagos; consulta ZkosterCompliance para verificar elegibilidad de participants.

### Módulo 2: ZkosterVerifier
Contrato de verificación ZK. No administra lógica de negocio; solo responde si una prueba es válida o no.

**Responsabilidades (implementadas):**
- `verify_groth16(proof, public_inputs)`: verifica pruebas Groth16 onchain usando las host functions BN254 de Stellar (Protocol 25 X-Ray + Protocol 26 Yardstick). Cubre el **range proof** de cada payout (que el monto privado esté en rango válido).
- `check_commitment_sum(commitments, total)`: confirma que `Σ commitments == total` (regla #5) de forma **homomórfica**, sumando los puntos Pedersen y verificando que la diferencia es la identidad vía un `pairing_check`. **No requiere SNARK** para el sum check.

> **Refinamiento sobre el draft:** el draft decía "la suma no *excede* el total" (≤). La implementación verifica **igualdad** (`==`), que es lo que pide la regla de negocio #5. La igualdad sale gratis del homomorfismo de Pedersen; el Groth16 queda reservado para lo que el homomorfismo no puede dar (range proofs). La verificación de "payout pertenece a batch aprobado" es responsabilidad de `ZkosterPayroll` (state machine), no del verifier.

**Esquema criptográfico:** commitments **Pedersen sobre BN254**, pruebas **Groth16**. Serialización validada contra el host (test `verifier/tests/groth16_real.rs` con pruebas reales generadas por arkworks): G1 = `x‖y` big-endian (64 bytes), G2 = `x.c1‖x.c0‖y.c1‖y.c0` orden EIP-197 (128 bytes).

**Principio:** es un árbitro matemático stateless (salvo la verifying key) y reutilizable.

### Módulo 3: ZkosterCompliance
Contrato de políticas, membership y disclosure.

**Responsabilidades:**
- Mantener la allowlist de wallets autorizadas (empleados, admins, auditores).
- Administrar exclusiones o denylist de participantes.
- Emitir y revocar `DisclosureGrant`.
- Resolver si un auditor tiene acceso a un batch o payout específico.
- Opcionalmente: mantener Merkle trees de membership para pruebas de pertenencia.

**Relación con el modelo:** separa explícitamente "el dinero" (ZkosterPayroll) de "quién puede participar y qué puede ver" (ZkosterCompliance).

### Resumen de arquitectura

```
                  ┌──────────────────────────────────┐
                  │         ZkosterPayroll            │
                  │  (treasury, batches, payouts,     │
                  │   estados, receipts)              │
                  └───────────┬──────────┬────────────┘
                              │          │
               ┌──────────────▼──┐   ┌──▼────────────────────┐
               │ ZkosterVerifier │   │  ZkosterCompliance     │
               │ (ZK proof check)│   │  (membership, grants,  │
               │                 │   │   disclosure policy)   │
               └─────────────────┘   └────────────────────────┘
```

---

## 12. Visibilidad por actor

| Actor | Ve | No ve |
|-------|-----|-------|
| Público (ledger) | Actividad general, estados verificados | Montos salariales individuales, relaciones empresa-empleado detalladas |
| Empresa (Admin) | Batch totals, estado, lista de pagos, flags, operaciones internas | — |
| Empleado | Solo su propio pago, historial propio, receipt | Nómina completa, salarios de otros |
| Auditor autorizado | Totales del batch, pagos dentro de su `DisclosureGrant` | Pagos fuera de su scope, montos no autorizados |

---

## 13. Reglas de negocio mínimas

1. Solo una empresa registrada y autorizada puede crear un batch.
2. Solo un batch en estado `approved` puede pasar a `funded` y luego a ejecución.
3. Solo recipients con `eligibility_status: authorized` pueden recibir pagos.
4. Un payout individual no puede ejecutarse más de una vez.
5. La suma de commitments de payouts debe ser **igual** al `total_commitment` del batch (verificado homomórficamente por `ZkosterVerifier` en `approve_batch`).
6. Un auditor solo puede acceder a batches o pagos donde tenga un `DisclosureGrant` vigente.
7. El public ledger no debe exponer montos salariales individuales en texto claro.
8. Un batch solo puede pagarse si está fondeado.

---

## 14. MVP Scope

### Features incluidas

- Login demo por rol: Admin, Employee, Auditor.
- Dashboard de batches para el Admin.
- Creación de nuevo batch.
- Upload y validación de CSV de nómina.
- Review screen con totales y errores.
- Ejecución de payout privado (simulada o semi-real según tiempo disponible).
- Seguimiento de estado por batch y por pago.
- Portal del empleado con historial propio.
- Auditor view con disclosure selectivo demo.
- Receipts básicos por pago.
- Tres contratos Soroban: ZkosterPayroll, ZkosterVerifier, ZkosterCompliance.

### Decisiones de implementación para MVP (tomadas)

- **Private batch payroll** como modalidad única (no streaming).
- **Privacidad: Confidential Transfers** (no SPP). En payroll las partes se conocen (la empresa hace KYC de sus empleados vía `ZkosterCompliance`); lo confidencial es el **monto**. Confidential Transfers oculta montos/balances y deja las partes visibles — el fit correcto. SPP (que también oculta sender/receiver) sería overkill y pelearía contra la allowlist de compliance.
- **Esquema:** commitments **Pedersen sobre BN254** + range proofs **Groth16**. La igualdad `Σ commitments == total` se resuelve homomórficamente sin SNARK.
- **Toolchain:** Soroban con `soroban-sdk 26.1.0` (Protocol 26 / Yardstick), usando las host functions BN254 nativas.
- **Modelo:** una instancia del trío de contratos por empresa (`initialize(admin)`).

### Estado de la capa de contratos

- ✅ Tres contratos Soroban implementados, testeados y compilando a wasm (`ZkosterPayroll`, `ZkosterVerifier`, `ZkosterCompliance`).
- ✅ Verificación ZK validada con **pruebas Groth16 reales** y commitments Pedersen reales (no mocks); serialización confirmada contra el host.
- ⏳ **Pendiente para producción:** el circuito Noir del range proof de negocio y su verifying key (`set_vk`). El circuito fixture actual (`a·b == c`) valida el verifier, no la semántica de payroll.
- **Demo con datos de prueba** para roles de empleado y auditor; flujo de admin funcional.

---

## 15. Non-goals del MVP

Los siguientes elementos están fuera del alcance del MVP y corresponden a fases posteriores:

- Cálculo de impuestos por país o jurisdicción.
- HRIS completo o gestión de beneficios.
- Integraciones reales con Workday, ADP, BambooHR o similares.
- Compliance multinacional completo.
- Streaming payroll en tiempo real.
- Motor de FX o conversión multi-moneda.
- Onboarding legal automatizado.
- Multi-tenancy enterprise de producción.

---

## 16. Pitch de 30 segundos

> Las empresas que pagan nómina en stablecoins sobre blockchain pública están publicando sus salarios en internet de forma permanente. Zkoster resuelve eso: es una workspace de payroll privado sobre Stellar donde RR.HH. sube un batch, los empleados reciben pagos confidenciales y solo ven los suyos, y un auditor autorizado puede revisar lo necesario con disclosure selectivo. Privado por defecto, auditable cuando hace falta, sobre los rails de Stellar.

---

*Zkoster MVP — Hackathon build. Stellar + Soroban + ZK.*
