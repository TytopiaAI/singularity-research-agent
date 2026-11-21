// Contours follow the user's latest two references: the V-crown helmet and
// the turned, bent-arm torso. All final coordinates are shared with particles.
export interface ArmorPanel { name: string; path: string; metal: 'red' | 'gold' | 'dark'; delay: number; backing?: boolean }

// The traced source uses only absolute M/L/H/V/C/Q/Z commands.
function place(path: string, scale: number, dx: number, dy: number): string {
  let command = '', coordinate = 0
  return path.replace(/[MLHVCQZ]|-?\d+(?:\.\d+)?/g, token => {
    if (/^[A-Z]$/.test(token)) { command = token; coordinate = 0; return token }
    const isX = command === 'H' || (command !== 'V' && coordinate++ % 2 === 0)
    return String(Math.round((Number(token) * scale + (isX ? dx : dy)) * 100) / 100)
  })
}
const body = (path: string) => place(path, 1.65, 48, 28)
const head = (path: string) => body(place(path, .15, 212, 25))
const part = (name: string, metal: ArmorPanel['metal'], delay: number, path: string): ArmorPanel => ({name,metal,delay,path:body(path)})
const helmet = (name: string, metal: ArmorPanel['metal'], delay: number, path: string): ArmorPanel => ({name,metal,delay,path:head(path)})

// Rear accessories from the same reference, authored separately to preserve the suit.
export const armorBackPanels: ArmorPanel[] = [
  part('back-upper-right-shell','red',1.2,'M475 231 Q520 218 558 209 L608 194 612 200 603 208 559 223 528 242 501 253 480 251Z'),
  part('back-upper-right-inner','gold',1.3,'M492 237 515 232 558 218 606 201 609 207 562 226 531 247 509 260 491 251Z'),
  part('back-upper-right-spine','dark',1.4,'M487 247 518 238 555 221 604 207 596 216 553 235 519 256 496 265Z'),
  part('back-upper-right-edge','red',1.35,'M501 229 558 211 606 197 608 201 560 217 511 237Z'),
  part('back-upper-right-hinge','gold',1.4,'M482 238 493 232 509 243 508 254 499 262 486 256Z'),
  part('back-lower-right-shell','red',1.35,'M386 406 403 409 447 433 481 449 479 463 427 445 390 436Z'),
  part('back-lower-right-inner','gold',1.45,'M404 418 448 439 476 451 475 459 446 450 407 431Z'),
  part('back-lower-right-end','dark',1.5,'M469 447 482 450 482 460 476 465 468 461Z'),
  part('back-lower-left-shell','red',1.3,'M222 421 209 444 182 458 94 505 72 520 111 511 161 496 205 479 228 451Z'),
  part('back-lower-left-face','red',1.4,'M209 447 193 465 112 505 88 514 117 494 183 457 216 432Z'),
  part('back-lower-left-ridge','gold',1.5,'M88 515 116 504 171 485 205 463 208 468 173 491 117 509Z'),
  part('back-lower-left-hinge','dark',1.4,'M214 422 229 422 231 444 224 461 213 463 205 452Z'),
]
export const armorBackSeams = [
  'M510 240 523 231 529 239 542 224 549 231 564 216 574 221 588 209 596 212',
  'M505 248 518 247 532 237 546 234 559 225 574 221 588 214',
  'M413 425 416 432 M423 430 426 437 M434 435 438 443 M446 441 449 448 M458 447 461 453',
  'M105 506 155 484 194 461 M151 483 160 487 M173 472 181 479 M192 460 199 467',
].map(body)

export const armorPanels: ArmorPanel[] = [
  part('torso-understructure','dark',.6,'M234 193 300 175 378 171 424 219 442 298 407 388 392 489 334 529 215 505 214 421 224 345 189 278Z'),
  part('neck','dark',.7,'M294 160 321 180 350 168 368 188 349 211 309 219 280 203Z'),
  part('collar-left','gold',.5,'M286 170 271 179 250 200 256 211 275 205 284 187Z'),
  part('collar-right','gold',.5,'M350 171 366 176 376 200 355 211 341 205 346 190Z'),
  part('collar-shell-left','red',.4,'M277 171 254 178 229 195 243 215 257 211 264 189Z'),
  part('collar-shell-right','red',.4,'M361 167 Q384 169 404 188 L422 210 384 216 374 196Z'),
  part('collar-inset-left','dark',.8,'M269 184 276 183 271 197 260 204 256 201Z'),
  part('collar-inset-right','dark',.8,'M351 184 359 182 367 198 359 204 348 199Z'),
  part('shoulder-left','red',1,'M240 181 Q212 178 184 191 Q148 207 138 245 L137 258 156 266 178 252 199 259 218 223 247 210Z'),
  part('shoulder-left-ridge','red',1.2,'M174 200 Q200 186 224 189 L234 207 211 222 197 246 184 243 178 226Z'),
  part('shoulder-right','red',1,'M410 190 Q441 175 471 190 Q507 210 517 245 L517 269 Q507 286 485 282 L455 271 432 256 409 257 392 228 379 208Z'),
  part('shoulder-right-ridge','red',1.2,'M389 208 Q430 210 473 191 L482 200 Q449 224 407 231Z'),
  part('shoulder-right-rim','red',1.3,'M408 245 Q443 245 469 265 Q492 276 513 267 L511 278 Q490 287 464 274 L432 259 410 258Z'),
  part('axilla-left','dark',1.2,'M175 251 188 254 202 277 197 322 169 310 147 286 146 270Z'),
  part('axilla-right','dark',1.2,'M400 254 422 253 433 275 457 286 453 320 433 354 405 334 396 302Z'),
  part('chest','red',.1,'M235 215 Q264 204 305 209 L342 207 375 202 390 228 Q403 261 400 292 L390 316 344 330 311 353 249 354 222 335 Q196 311 198 277 Q198 240 235 215Z'),
  part('bicep-left','red',1.4,'M142 273 160 286 178 309 177 329 154 354 131 357 112 338 Q114 308 130 285Z'),
  part('bicep-left-inset','gold',1.6,'M134 281 143 281 128 316 122 335 116 331 123 301Z'),
  part('bicep-right','red',1.4,'M456 292 Q477 286 493 302 L521 336 534 371 517 390 493 382 474 356 447 323Z'),
  part('bicep-right-ridge','red',1.6,'M469 295 Q486 295 496 314 L519 346 525 365 515 373 493 343 477 318Z'),
  part('elbow-left','dark',1.7,'M111 338 132 359 155 354 146 377 119 389 100 376 97 355Z'),
  part('forearm-left','red',1.9,'M35 347 74 342 107 338 116 358 143 378 Q129 394 106 392 L60 387 24 371Z'),
  part('forearm-left-ridge','gold',2,'M38 342 70 339 104 328 108 339 87 351 64 355 34 354Z'),
  part('forearm-left-edge','red',2,'M30 360 66 367 110 370 126 379 110 383 63 376 30 369Z'),
  part('palm-left','red',2.1,'M7 325 20 320 29 335 31 355 23 370 9 365 2 348Z'),
  part('fingers-left','red',2.2,'M5 329 1 316 4 303 10 305 12 323 14 327 15 308 20 305 24 309 24 331 29 337 28 349 20 351 15 340Z'),
  part('elbow-right','dark',1.8,'M518 380 534 365 551 378 555 405 539 417 517 401Z'),
  part('forearm-right','red',2,'M536 408 552 394 568 410 577 454 567 482 551 472 539 444Z'),
  part('lower-chest','red',.5,'M247 357 309 358 301 380 280 396 246 393 229 379 231 359Z'),
  part('gold-rib-left','gold',.8,'M222 324 233 329 246 353 240 367 224 362 219 344Z'),
  part('gold-rib-right','gold',.8,'M333 330 381 320 390 326 373 338 346 342 329 365 309 366 305 354Z'),
  part('rib-right-upper','red',1,'M348 346 377 335 391 329 401 341 393 352 366 361 337 387 306 393 302 383 328 374Z'),
  part('rib-right-middle','red',1.1,'M363 367 394 353 404 362 397 379 376 387 343 418 313 423 302 409 328 402Z'),
  part('rib-right-lower','gold',1.2,'M378 389 400 382 408 390 400 408 382 415 369 443 347 451 336 441 356 421Z'),
  part('abdomen-upper','red',1.1,'M237 396 280 404 300 394 319 409 302 424 267 428 240 418 229 407Z'),
  part('abdomen-mid','red',1.3,'M235 422 267 435 300 431 317 440 308 457 271 467 238 454 226 438Z'),
  part('abdomen-lower','red',1.5,'M235 460 273 475 302 467 327 477 315 498 277 512 239 498 224 480Z'),
  part('flank-right','red',1.6,'M347 451 370 440 387 418 397 422 391 451 373 471 340 489 321 483 326 465Z'),
  part('gold-flank-right','gold',1.7,'M374 475 390 459 386 491 371 510 344 519 325 509 341 495Z'),
  part('flank-left','gold',1.5,'M219 413 231 418 226 443 230 459 217 465 208 450Z'),
  part('waist','red',2,'M216 480 242 504 279 519 320 505 339 520 326 542 H226 L207 518Z'),
  // Add complete gauntlets over the original hand stubs; existing contours stay intact.
  {...part('hand-left-shell','red',2,'M20 309 Q4 297 -10 303 L-22 314 Q-27 328 -23 345 L-17 361 -2 373 21 372 34 357 31 337 34 322Z'),backing:true},
  part('hand-left-index','red',2.05,'M-12 307 Q-3 302 8 306 L15 313 12 320 -14 323 -21 316Z'),
  part('hand-left-middle','red',2.08,'M-18 324 10 321 17 328 11 336 -18 340 -24 332Z'),
  part('hand-left-ring','red',2.11,'M-19 341 10 338 17 345 11 352 -15 355 -22 348Z'),
  part('hand-left-little','red',2.14,'M-14 357 8 354 16 361 11 368 -4 369 -15 363Z'),
  part('hand-left-knuckle-caps','gold',2.15,'M-19 313 -14 309 -10 311 -12 318 -17 320 -21 316Z M-23 328 -17 325 -14 328 -15 335 -20 337 -24 332Z M-21 345 -16 341 -12 344 -13 351 -17 352 -22 348Z M-14 360 -10 357 -6 359 -6 365 -10 366 -15 363Z'),
  part('hand-left-thumb','red',2.18,'M14 318 25 315 34 328 29 343 20 351 11 345 17 335 11 329Z'),
  part('hand-left-thumb-inset','gold',2.2,'M24 321 29 326 27 336 23 341 20 338 23 330Z'),
  part('hand-left-palm-heel','red',2.15,'M19 351 31 344 31 359 23 371 6 371 8 364Z'),
  {...part('hand-right-shell','red',2,'M556 475 575 469 Q589 473 599 485 L605 502 604 518 594 534 570 536 555 527 550 509 551 490Z'),backing:true},
  part('hand-right-cuff','red',2.02,'M555 476 574 471 587 480 584 490 562 493 552 486Z'),
  part('hand-right-palm','red',2.05,'M557 489 578 484 594 491 600 504 595 524 583 531 565 525 554 511Z'),
  part('hand-right-index','red',2.08,'M575 490 591 486 599 490 601 498 593 502 575 501 569 496Z'),
  part('hand-right-middle','red',2.11,'M573 503 594 501 603 505 603 512 595 517 574 514 569 509Z'),
  part('hand-right-ring','red',2.14,'M574 516 593 515 600 520 598 527 589 531 572 526 569 521Z'),
  part('hand-right-little','red',2.17,'M572 528 588 531 593 532 587 537 573 537 566 532Z'),
  part('hand-right-knuckle-caps','gold',2.18,'M594 489 599 491 600 497 594 500 590 497Z M598 504 603 507 602 512 596 516 592 512Z M595 518 600 521 597 527 591 529 589 525Z M585 532 591 532 587 536 581 536Z'),
  part('hand-right-thumb','red',2.2,'M555 486 565 483 578 491 585 501 581 509 573 512 566 506 561 498 551 497 548 492Z'),
  part('hand-right-thumb-inset','gold',2.22,'M558 488 564 487 572 493 578 502 574 506 568 502 564 496 555 493Z'),
  helmet('helmet-shell','red',1.6,'M470 227 Q461 139 521 101 Q619 40 741 40 Q889 39 987 132 Q1023 166 1024 252 L1062 402 Q1080 501 1037 613 L1000 759 968 894 886 1015 775 1110 709 1099 603 1007 514 892 482 754 448 627 Q412 525 434 414Z'),
  helmet('faceplate','gold',2,'M488 168 553 158 Q571 163 594 191 L656 267 Q683 302 709 311 Q749 319 781 308 Q807 296 837 259 L902 183 Q923 157 945 157 L997 169 Q1010 294 1000 414 L985 479 1002 516 Q1006 580 965 640 L913 716 881 803 865 847 840 831 Q824 826 802 829 H682 Q648 826 626 848 L609 839 573 758 525 687 Q482 636 467 576 L465 517 483 476 Q463 383 473 274Z'),
  helmet('jaw-plate','gold',2.1,'M625 849 Q648 835 680 836 H805 Q835 836 858 849 L878 850 914 916 890 959 858 942 837 899 Q822 878 797 878 H689 Q662 879 648 900 L623 947 597 965 572 925 603 853Z'),
  helmet('chin-shell','red',2.2,'M648 907 Q667 882 692 885 H795 Q824 886 839 907 L858 949 846 982 808 1000 790 1032 748 1080 710 1031 688 1001 650 980 632 947Z'),
  helmet('temple-left','red',1.8,'M452 317 473 271 463 407 483 478 470 512 450 483 440 417Z'),
  helmet('temple-right','red',1.8,'M1021 278 1042 323 1058 419 1043 488 1010 514 990 480 1011 406Z'),
  helmet('jaw-vent-left','dark',1.9,'M507 697 533 706 581 833 566 871 546 846 521 778Z'),
  helmet('jaw-vent-right','dark',1.9,'M967 699 943 705 899 831 913 870 935 846 954 778Z'),
]
export const armorEyeSockets = head('M482 482 Q548 519 671 528 L661 560 Q549 572 489 532 L474 512Z M999 482 Q937 518 817 530 L824 560 Q932 567 991 531 L1006 512Z')
export const armorEyes = head('M511 504 Q573 527 663 534 L655 551 Q570 558 514 534Z M973 504 Q915 528 825 536 L831 551 Q917 555 970 533Z')
export const armorSeams = [
  head('M498 219 499 180 548 175 585 207 M986 219 985 181 948 175 910 211'),
  head('M485 476 Q596 534 745 532 Q881 532 985 479'),
  head('M601 855 624 849 M864 848 884 842 M657 946 Q743 914 833 944'),
  head('M516 879 Q565 1005 685 1051 M974 882 Q922 1004 811 1051'),
  ...[
    'M230 218 235 249 M311 211 295 230 278 257 M376 210 389 246 392 285',
    'M213 281 Q209 313 233 331 L244 343 M288 343 309 338 331 322 378 311',
    'M181 196 194 212 211 225 M177 202 190 220 204 231',
    'M406 199 Q442 198 466 189 M414 217 Q451 214 481 201 M428 238 Q465 240 490 261',
    'M155 271 171 296 186 309 M151 277 165 300 182 315 M410 270 429 304 438 316 M407 280 424 315 434 329',
    'M250 365 H289 M245 383 275 388 295 380 M244 412 271 419 299 413',
    'M342 350 366 345 382 337 M337 375 365 364 388 357 M349 400 373 385 390 378',
    'M237 444 272 455 300 446 M244 485 275 497 304 484',
    'M122 316 133 339 146 343 M470 313 489 339 502 363 M38 359 75 362 104 356',
    'M285 189 300 200 326 200 339 191 M288 194 300 207 325 207',
  ].map(body),
]
export const armorCore = { x: 48 + 274 * 1.65, y: 28 + 283 * 1.65 }
// The latest torso reference has a tapered pentagonal aperture, not a round core.
export const armorCorePath = 'M-32-35 Q-27-42-20-39 L-10-34 H13 L23-39 Q29-40 32-33 L39-22 Q41-18 38-10 L20 29 Q17 35 10 35 H-11 Q-18 35-21 28 L-38-12 Q-42-20-36-29Z'
