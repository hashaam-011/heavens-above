import fs from 'fs'
import request from 'request'
import cheerio from 'cheerio'
import utils from './utils.js'

const eventsIridium = ['brightness', 'altitude', 'azimuth', 'satellite', 'distanceToFlareCentre', 'brightnessAtFlareCentre', 'date', 'time', 'distanceToSatellite', 'AngleOffFlareCentre-line', 'flareProducingAntenna', 'sunAltitude', 'angularSeparationFromSun', 'image', 'id']

function getTable (config) {
  let database = config.database || []
  let counter = config.counter || 0
  let options
  const opt = config.opt || ''
  const basedir = `${config.root}IridiumFlares/`

  if (counter === 0) {
    options = utils.get_options('IridiumFlares.aspx?')
    if (!fs.existsSync(basedir)) {
      fs.mkdir(basedir, (err) => {
        if (err) console.error('Directory creation error:', err)
      })
    }
  } else {
    options = utils.post_options('IridiumFlares.aspx?', opt)
  }

  request(options, (error, response, body) => {
    if (error || response.statusCode !== 200) return
    const $ = cheerio.load(body, { decodeEntities: false })
    let next = '__EVENTTARGET=&__EVENTARGUMENT=&__LASTFOCUS='
    const tbody = $('form').find('table.standardTable tbody')
    const queue = []

    tbody.find('tr').each((i, o) => {
      const temp = {}
      for (let j = 0; j < 6; j++) {
        temp[eventsIridium[j]] = $(o).find('td').eq(j + 1).text()
      }
      temp.url = `https://www.heavens-above.com/${$(o).find('td').eq(0).find('a').attr('href').replace('type=V', 'type=A')}`
      queue.push(temp)
    })

    async function factory (temp) {
      return await new Promise((resolve, reject) => {
        request(utils.iridium_options(temp.url), (error, response, body) => {
          if (error || response.statusCode !== 200) {
            reject(error)
            return
          }
          console.log('Success:', temp)
          const $ = cheerio.load(body, { decodeEntities: false })
          const table = $('form').find('table.standardTable')
          const tr = table.find('tbody tr');
          [
            [6, 0],
            [7, 1],
            [8, 6],
            [9, 7],
            [10, 9],
            [11, 10],
            [12, 11]
          ].forEach((ele) => {
            temp[eventsIridium[ele[0]]] = tr.eq(ele[1]).find('td').eq(1).text()
          })
          temp[eventsIridium[13]] = `https://www.heavens-above.com/${$('#ctl00_cph1_imgSkyChart').attr('src')}`
          const id = utils.md5(Math.random().toString())
          temp[eventsIridium[14]] = id
          fs.appendFile(`${basedir}${id}.html`, table.html(), (err) => {
            if (err) console.error('File writing error:', err)
          })
          request.get(utils.image_options(temp[eventsIridium[13]])).pipe(fs.createWriteStream(`${basedir}${id}.png`, {
            flags: 'a'
          })).on('error', (err) => {
            console.error('Image download error:', err)
          })
          resolve(temp)
        })
      })
    }

    Promise.allSettled(queue.map(async temp => await factory(temp))).then(results => {
      results = results.filter(p => p.status === 'fulfilled').map(p => p.value)
      database = database.concat(results)
      $('form').find('input').each((i, o) => {
        if ($(o).attr('name') !== 'ctl00$cph1$btnPrev' && $(o).attr('name') !== 'ctl00$cph1$visible') {
          next += `&${$(o).attr('name')}=${$(o).attr('value')}`
        }
      })
      next += '&ctl00$cph1$visible=radioVisible'
      next = next.replace(/\+/g, '%2B').replace(/\//g, '%2F')
      if (counter++ < config.pages) {
        getTable({
          count: config.count,
          pages: config.pages,
          root: config.root,
          counter,
          opt: next,
          database
        })
      } else {
        fs.appendFile(`${basedir}index.json`, JSON.stringify(database), (err) => {
          if (err) console.error('Final JSON writing error:', err)
        })
      }
    })
  })
}

export { getTable }
