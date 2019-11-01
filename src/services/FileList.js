/**
 * @copyright Copyright (c) 2019 John Molakvoæ <skjnldsv@protonmail.com>
 *
 * @author John Molakvoæ <skjnldsv@protonmail.com>
 *
 * @license GNU AGPL version 3 or any later version
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 *
 */

import { getSingleValue, getValueForKey, parseXML, propsToStat } from 'webdav/dist/interface/dav'
import { handleResponseCode, processResponsePayload } from 'webdav/dist/response'
import { normaliseHREF, normalisePath } from 'webdav/dist/url'
import client, { remotePath } from './DavClient'
import pathPosix from 'path-posix'
import request from './DavRequest'

/**
 * List files from a folder and filter out unwanted mimes
 *
 * @param {String} path the path relative to the user root
 * @param {Object} [options] optional options for axios
 * @returns {Array} the file list
 */
export default async function(path, options) {
	options = Object.assign({
		method: 'PROPFIND',
		headers: {
			Accept: 'text/plain',
			Depth: options.deep ? 'infinity' : 1
		},
		responseType: 'text',
		data: request,
		details: true
	}, options)

	/**
	 * Fetch listing
	 *
	 * we use a custom request because getDirectoryContents filter out the current directory,
	 * but we want this as well to save us an extra request
	 * see https://github.com/perry-mitchell/webdav-client/blob/baf858a4856d44ae19ac12cb10c469b3e6c41ae4/source/interface/directoryContents.js#L11
	 */
	let response = null
	const { data } = await client.customRequest(path, options)
		.then(handleResponseCode)
		.then(res => {
			response = res
			return res.data
		})
		.then(parseXML)
		.then(result => getDirectoryFiles(result, remotePath, options.details))
		.then(files => processResponsePayload(response, files, options.details))

	const list = data
		.map(entry => {
			return Object.assign({
				id: parseInt(entry.props.fileid),
				isFavorite: entry.props.favorite !== '0',
				hasPreview: entry.props['has-preview'] !== 'false'
			}, entry)
		})

	// filter all the files and folders
	let folder = {}
	const folders = []
	const files = []
	for (let entry of list) {
		if (entry.filename === path) {
			folder = entry
		} else if (entry.type === 'directory') {
			folders.push(entry)
		} else if (entry.mime === 'image/jpeg') {
			files.push(entry)
		}
	}

	// return current folder, subfolders and files
	return { folder, folders, files }
}

function getDirectoryFiles(result, serverBasePath, isDetailed = false) {
	const serverBase = pathPosix.join(serverBasePath, '/')
	// Extract the response items (directory contents)
	const multiStatus = getValueForKey('multistatus', result)
	const responseItems = getValueForKey('response', multiStatus)
	return (
		responseItems
		// Map all items to a consistent output structure (results)
			.map(item => {
				// HREF is the file path (in full)
				let href = getSingleValue(getValueForKey('href', item))
				href = normaliseHREF(href)
				// Each item should contain a stat object
				const propStat = getSingleValue(getValueForKey('propstat', item))
				const props = getSingleValue(getValueForKey('prop', propStat))
				// Process the true full filename (minus the base server path)
				const filename
                    = serverBase === '/' ? normalisePath(href) : normalisePath(pathPosix.relative(serverBase, href))
				return propsToStat(props, filename, isDetailed)
			})
	)
}
