// ==UserScript==
// @name         Extrator de Matrículas SigEduca
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Automação para extrair histórico e dados pessoais por INEP
// @author       Você
// @match        http://sigeduca.seduc.mt.gov.br/ged/HWCMatriculasAluno.aspx?*
// @grant        none
// @updateURL    https://github.com/lksoumon/extrair_matriculas/raw/refs/heads/main/extrair_matriculas.user.js
// @downloadURL   https://github.com/lksoumon/extrair_matriculas/raw/refs/heads/main/extrair_matriculas.user.js
// ==/UserScript==

(function() {
    'use strict';

    // 1. INJETAR O MENU NA LATERAL
    const panel = document.createElement('div');
    panel.innerHTML = `
        <div style="position: fixed; top: 150px; left: 10px; width: 260px; background: #ffffff; border: 2px solid #065195; border-radius: 5px; box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 99999; padding: 15px; font-family: Verdana, sans-serif; font-size: 12px;">
            <h3 style="margin-top: 0; color: #065195; text-align: center;">Automação Consulta</h3>
            <p style="margin: 5px 0;">Cole os INEPs (um por linha):</p>
            <textarea id="tm-ineps" rows="8" style="width: 100%; box-sizing: border-box; resize: vertical; margin-bottom: 10px;"></textarea>

            <label style="display: block; margin-bottom: 15px; cursor: pointer;">
                <input type="checkbox" id="tm-only-latest" checked>
                Mostrar APENAS a última situação
            </label>

            <button id="tm-start" style="width: 100%; background: #065195; color: white; border: none; padding: 10px; font-weight: bold; cursor: pointer; border-radius: 3px;">INICIAR EXTRAÇÃO</button>
            <div id="tm-status" style="margin-top: 10px; font-weight: bold; text-align: center; color: #333;">Aguardando...</div>
        </div>
    `;
    document.body.appendChild(panel);

    // Variáveis de estado
    let inepList = [];
    let currentIndex = 0;
    let allResults = [];
    let onlyLatest = false;

    // 2. EVENTO DE CLIQUE PARA INICIAR
    document.getElementById('tm-start').addEventListener('click', async () => {
        const text = document.getElementById('tm-ineps').value;
        inepList = text.split('\n').map(t => t.trim()).filter(t => t.length > 0);
        onlyLatest = document.getElementById('tm-only-latest').checked;
        currentIndex = 0;
        allResults = [];

        if (inepList.length === 0) {
            alert('Por favor, insira pelo menos um INEP.');
            return;
        }

        document.getElementById('tm-start').disabled = true;
        document.getElementById('tm-start').style.background = '#ccc';
        await processarFila();
    });

    // 3. FUNÇÃO PRINCIPAL DE CONTROLE DA FILA
    async function processarFila() {
        if (currentIndex >= inepList.length) {
            finalizarEGerarTabela();
            return;
        }

        const currentInep = inepList[currentIndex];
        document.getElementById('tm-status').innerText = `Processando: ${currentIndex + 1} de ${inepList.length}\nINEP: ${currentInep}`;

        const inputInep = document.getElementById('vGEDALUIDINEP');
        if (inputInep) {
            inputInep.value = currentInep;
            inputInep.dispatchEvent(new Event('change'));
            inputInep.dispatchEvent(new Event('blur'));
        }

        const gridContainer = document.getElementById('FreesgridContainerDiv');
        if (gridContainer) gridContainer.innerHTML = '';
        const errViewer = document.getElementById('gxErrorViewer');
        if (errViewer) errViewer.innerText = '';

        const btnConsultar = document.getElementsByName('BCONSULTAR')[0];
        if (btnConsultar) {
            btnConsultar.click();
        } else {
            console.error("Botão Consultar não encontrado!");
        }

        await aguardarResultado();
        extrairDadosDaTela(currentInep);

        currentIndex++;
        setTimeout(processarFila, 800);
    }

    // 4. FUNÇÃO PARA ESPERAR O AJAX DO GENEXUS RESPONDER
    function aguardarResultado() {
        return new Promise((resolve) => {
            let attempts = 0;
            const limit = 30; // 15 segundos máximo

            const check = setInterval(() => {
                attempts++;
                const table = document.getElementById('FreesgridContainerTbl');
                const errViewer = document.getElementById('gxErrorViewer');

                let temErro = errViewer && errViewer.innerText.trim().length > 0;

                if (table || temErro || attempts >= limit) {
                    clearInterval(check);
                    resolve();
                }
            }, 500);
        });
    }

    // 5. EXTRAÇÃO DOS DADOS
    function extrairDadosDaTela(inep) {
        const table = document.getElementById('FreesgridContainerTbl');
        const errViewer = document.getElementById('gxErrorViewer');

        let msgErro = errViewer ? errViewer.innerText.trim() : "";

        // Captura os dados do aluno no cabeçalho
        const nomeEl = document.getElementById('span_vGEDALUNOM');
        const nascEl = document.getElementById('span_vGERPESDTANASC');
        const maeEl = document.getElementById('span_vGERPESNOMMAE');

        let nomeAluno = nomeEl ? nomeEl.innerText.trim() : '-';
        let nascAluno = nascEl ? nascEl.innerText.trim() : '-';
        let maeAluno = maeEl ? maeEl.innerText.trim() : '-';

        // Limpa a data de nascimento se vier apenas a máscara vazia " / / "
        if (nascAluno.replace(/\//g, '').trim() === '') {
            nascAluno = '-';
        }

        // Se deu erro ou não encontrou tabela, salva o que deu pra pegar
        if (!table) {
            allResults.push({
                inep: inep,
                nome: nomeAluno,
                nascimento: nascAluno,
                mae: maeAluno,
                escola: msgErro || 'Nenhum resultado / Timeout',
                turma: '-',
                situacao: '-',
                dataMatricula: '-',
                dataAjuste: '-'
            });
            return;
        }

        const blocosIniciais = table.querySelectorAll('tr[id^="FreesgridContainerRow_"]');

        if (blocosIniciais.length === 0) {
            allResults.push({
                inep: inep, nome: nomeAluno, nascimento: nascAluno, mae: maeAluno,
                escola: 'Sem movimentações', turma: '-', situacao: '-', dataMatricula: '-', dataAjuste: '-'
            });
            return;
        }

        let extraido = [];

        blocosIniciais.forEach(bloco => {
            const rowIndex = bloco.getAttribute('gxrow');

            const escolaEl = document.getElementById('span_vGERLOTNOMAUX_' + rowIndex);
            const turmaEl = document.getElementById('span_vGERTURSAL_' + rowIndex);
            const dataMatriculaEl = document.getElementById('span_vGEDMATDTA_' + rowIndex);
            const dataAjusteEl = document.getElementById('span_vGEDAJSDTA_' + rowIndex);

            let situacaoEl = document.getElementById('span_vDSC_GEDMATDISCSIT_0001' + rowIndex);

            if (!situacaoEl) {
                const gridDisciplinas = document.getElementById('Grid1Container_' + rowIndex + 'Tbl');
                if (gridDisciplinas) {
                    situacaoEl = gridDisciplinas.querySelector('[id^="span_vDSC_GEDMATDISCSIT_"]');
                }
            }

            extraido.push({
                inep: inep,
                nome: nomeAluno,
                nascimento: nascAluno,
                mae: maeAluno,
                escola: escolaEl ? escolaEl.innerText.trim() : '-',
                turma: turmaEl ? turmaEl.innerText.trim() : '-',
                situacao: situacaoEl ? situacaoEl.innerText.trim() : 'NÃO INFORMADA',
                dataMatricula: dataMatriculaEl ? dataMatriculaEl.innerText.trim() : '-',
                dataAjuste: dataAjusteEl ? dataAjusteEl.innerText.trim() : '-'
            });
        });

        if (onlyLatest && extraido.length > 0) {
            allResults.push(extraido[extraido.length - 1]);
        } else {
            allResults.push(...extraido);
        }
    }

    // 6. GERA A TABELA FINAL HTML EM NOVA ABA
    function finalizarEGerarTabela() {
        document.getElementById('tm-status').innerText = 'CONCLUÍDO!';
        document.getElementById('tm-start').disabled = false;
        document.getElementById('tm-start').style.background = '#065195';

        let html = `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Relatório de Matrículas Extraídas</title>
                <style>
                    body { font-family: 'Verdana', sans-serif; padding: 20px; background-color: #f9f9f9; }
                    h2 { color: #065195; }
                    table { border-collapse: collapse; width: 100%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
                    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; font-size: 13px; }
                    th { background-color: #065195; color: white; white-space: nowrap; }
                    tr:nth-child(even) { background-color: #f2f2f2; }
                    tr:hover { background-color: #e2edfa; }
                </style>
            </head>
            <body>
                <h2>Relatório de Matrículas (${onlyLatest ? 'Apenas Última Situação' : 'Histórico Completo'})</h2>
                <table>
                    <thead>
                        <tr>
                            <th>INEP</th>
                            <th>Nome do Aluno</th>
                            <th>Data Nasc.</th>
                            <th>Nome da Mãe</th>
                            <th>Escola</th>
                            <th>Turma</th>
                            <th>Situação</th>
                            <th>Data Matrícula</th>
                            <th>Data Ajuste</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        allResults.forEach(r => {
            html += `
                <tr>
                    <td>${r.inep}</td>
                    <td><strong>${r.nome}</strong></td>
                    <td>${r.nascimento}</td>
                    <td>${r.mae}</td>
                    <td>${r.escola}</td>
                    <td>${r.turma}</td>
                    <td><strong>${r.situacao}</strong></td>
                    <td>${r.dataMatricula}</td>
                    <td>${r.dataAjuste}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </body>
            </html>
        `;

        const newWin = window.open('', '_blank');
        if (newWin) {
            newWin.document.write(html);
            newWin.document.close();
        } else {
            alert('Atenção: O navegador bloqueou a abertura da nova aba! Por favor, permita pop-ups para este site e rode novamente.');
        }
    }

})();
